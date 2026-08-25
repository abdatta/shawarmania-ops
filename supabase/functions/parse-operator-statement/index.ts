import * as XLSX from 'npm:xlsx@0.18.5'
import { unzipSync } from 'npm:fflate@0.8.2'

import { enabledRestaurantMappings } from '../_shared/restaurant-mappings.ts'
import { serviceClient } from '../_shared/authority.ts'
import { json, preflight } from '../_shared/http.ts'
import {
  parseStatement,
  StatementShapeError,
  type DecodedStatement,
  type OutletMap,
} from '../_shared/statement-parser-core.ts'

/**
 * The one door a statement comes through, from either caller.
 *
 * The reader posts the bytes it downloaded; a person posts the file they saved.
 * Both reach the same parser — the one in `_shared/statement-parser-core.ts`,
 * proved against real fixtures in a Node test — so the disaster-recovery path a
 * person uses is exercised by every scheduled run rather than only when it is
 * needed. This file is the thin part: it turns bytes into rows, checks who is
 * asking, and routes the parsed result to the ingest it belongs to.
 *
 * Registered verify_jwt = false because it answers two kinds of caller, and the
 * gateway cannot verify both. It checks them itself: the reader's shared secret,
 * or a person's session token whose outlet authority is re-derived here. Being an
 * Edge Function is not authorisation.
 */

interface OutletRow {
  id: string
  zomato_res_id: string | null
  hyperpure_delivery: boolean | null
}

/** No operator file this business receives is larger than this. */
const MAX_FILE_BYTES = 20 * 1024 * 1024

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function decode(bytes: Uint8Array): DecodedStatement {
  // A zip is the order-history export; anything else is a workbook. Sniffed by
  // the archive's own magic bytes, not the filename, which is often changed.
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04
  if (isZip) {
    // A workbook is ALSO a zip, so distinguish by what is inside: a workbook has
    // `xl/workbook.xml`; the order-history archive has a `.csv`.
    const files = unzipSync(bytes)
    const names = Object.keys(files)
    if (names.some((n) => /\.csv$/i.test(n))) {
      const csv: Record<string, string[][]> = {}
      for (const [name, content] of Object.entries(files)) {
        if (/\.csv$/i.test(name)) csv[name] = parseCsv(new TextDecoder().decode(content))
      }
      return { csv }
    }
  }
  const wb = XLSX.read(bytes, { type: 'array' })
  const sheets: Record<string, string[][]> = {}
  for (const name of wb.SheetNames) {
    sheets[name] = XLSX.utils.sheet_to_json(wb.Sheets[name], {
      header: 1,
      raw: false,
      dateNF: 'yyyy-mm-dd hh:mm:ss',
      defval: '',
    }) as string[][]
  }
  return { sheets }
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 1
        } else quoted = false
      } else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (c !== '\r') field += c
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((cell) => cell !== ''))
}

/**
 * The outlet map, read from the database rather than trusted from the caller.
 *
 * A res id and a delivery flag are outlet facts, so they live on the outlet row.
 * The caller says which outlets it may write for — the reader by its env allow
 * list, a person by their own assignments — and the map is narrowed to those, so
 * a statement can never be booked against an outlet the caller does not hold.
 */
async function outletMap(
  service: ReturnType<typeof serviceClient>,
  permitted: string[],
): Promise<OutletMap> {
  const { data, error } = await service
    .from('outlets')
    .select('id, zomato_res_id, hyperpure_delivery')
    .in('id', permitted)
  if (error) throw error
  const rows = (data ?? []) as OutletRow[]

  // Swiggy's restaurant references are mapping-table facts, not outlet columns:
  // one account holds active and dormant references, and only an enabled one may
  // book a file. The map is narrowed to the caller's permitted outlets, so a
  // file can never be booked against an outlet the caller does not hold.
  const { data: swiggyRows, error: swiggyError } = await enabledRestaurantMappings(
    service,
    'swiggy',
  ).in('outlet_id', permitted)
  if (swiggyError) throw swiggyError

  const zomatoResIds: Record<string, string> = {}
  let hyperpureOutletId = ''
  const swiggyRefs: Record<string, string> = {}
  for (const row of rows) {
    if (row.zomato_res_id) zomatoResIds[row.zomato_res_id] = row.id
    if (row.hyperpure_delivery) hyperpureOutletId = row.id
  }
  for (const row of (swiggyRows ?? []) as { outlet_id: string; external_ref: string }[]) {
    swiggyRefs[row.external_ref] = row.outlet_id
  }
  return { zomatoResIds, hyperpureOutletId, swiggyRefs }
}

function secretMatches(offered: string, expected: string): boolean {
  if (offered.length !== expected.length) return false
  let difference = 0
  for (let i = 0; i < offered.length; i += 1) {
    difference |= offered.charCodeAt(i) ^ expected.charCodeAt(i)
  }
  return difference === 0
}

/** Who is asking, and which outlets they may write for. */
async function authorise(
  req: Request,
  service: ReturnType<typeof serviceClient>,
): Promise<{ permitted: string[] } | { error: string; status: number }> {
  const header = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  if (!header) return { error: 'unauthorized', status: 401 }

  const secret = Deno.env.get('AGGREGATOR_SYNC_SECRET')
  if (secret && secretMatches(header, secret)) {
    // The reader: its allow list is the outlets its env names.
    const permitted = (Deno.env.get('AGGREGATOR_SYNC_OUTLETS') ?? '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean)
    return { permitted }
  }

  // A person: verify the session token and read the outlets they are assigned to.
  const { data: userData, error: userError } = await service.auth.getUser(header)
  if (userError || !userData.user) return { error: 'unauthorized', status: 401 }

  const { data: assignments, error: aError } = await service
    .from('assignments')
    .select('outlet_id, role')
    .eq('person_id', userData.user.id)
    .is('ended_on', null)
  if (aError) return { error: 'lookup_failed', status: 500 }

  // The owner is outlet-less by design and may write for every outlet; a manager
  // is scoped to the outlets they hold.
  if ((assignments ?? []).some((a) => a.role === 'super_admin')) {
    const { data: all, error: allError } = await service.from('outlets').select('id')
    if (allError) return { error: 'lookup_failed', status: 500 }
    return { permitted: (all ?? []).map((o) => o.id as string) }
  }

  const permitted = [
    ...new Set((assignments ?? []).map((a) => a.outlet_id as string).filter(Boolean)),
  ]
  if (permitted.length === 0) return { error: 'no_outlets', status: 403 }
  return { permitted }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const service = serviceClient()
  const who = await authorise(req, service)
  if ('error' in who) return json({ error: who.error }, who.status)

  const body = await req.json().catch(() => null)
  const base64 = body?.['file_base64']
  if (typeof base64 !== 'string' || base64 === '') {
    return json({ error: 'no_file' }, 400)
  }

  let bytes: Uint8Array
  try {
    bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
  } catch {
    return json({ error: 'unreadable_file' }, 400)
  }
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_FILE_BYTES) {
    return json({ error: 'file_size_out_of_range' }, 413)
  }

  // A PDF is recognised by its own magic and refused by name. A payment advice
  // proves money moved but carries no order rows, so it cannot settle anything
  // or invent a day; until its fields are parsed against proved layouts, an
  // honest named refusal beats a silent zero.
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return json(
      {
        error: 'pdf_not_actionable',
        detail:
          'payment advice or tax invoice recognised; order-level evidence is required to post',
      },
      422,
    )
  }

  let outlets: OutletMap
  try {
    outlets = await outletMap(service, who.permitted)
  } catch (cause) {
    console.error('could not read the outlet map', cause)
    return json({ error: 'lookup_failed' }, 500)
  }

  let parsed
  let digestHex: string
  try {
    digestHex = await sha256Hex(bytes)
    parsed = parseStatement(decode(bytes), outlets, { digestHex })
  } catch (cause) {
    if (cause instanceof StatementShapeError) {
      // A file this parser cannot place is the caller's to fix, and the message
      // names the shapes it looked for rather than failing blankly.
      return json({ error: 'unrecognised_statement', detail: cause.message }, 422)
    }
    console.error('parse failed', cause)
    return json({ error: 'parse_failed' }, 500)
  }

  // A Business Metrics Report is calendar-day evidence about the portal's own
  // numbers. It is answered with what it contained and written nowhere.
  if (parsed.kind === 'swiggy-metrics-evidence') {
    return json({ kind: parsed.kind, days: parsed.days.length }, 200)
  }

  // What a file left behind: its digest, the parser that read it, and the
  // sanitized candidate - never the bytes, which carry customer rows. The path
  // is server-generated with the outlet first, exactly the shape the storage
  // policies grant on, so raw PII-bearing uploads have no reason to exist.
  const PARSE_VERSION = 'swiggy-annexure@1'

  const results: unknown[] = []
  try {
    if (parsed.kind === 'hyperpure-statement') {
      const { data, error } = await service.rpc('ingest_supply_statement', {
        p_payload: parsed.statement,
        p_permitted_outlets: who.permitted,
      })
      if (error) throw error
      results.push(data)
    } else {
      for (const cycle of parsed.cycles) {
        const { data, error } = await service.rpc('ingest_aggregator_cycle', {
          p_payload: cycle,
          p_permitted_outlets: who.permitted,
        })
        if (error) throw error
        results.push(data)
      }
      // The annexure's sanitized candidate is retained as evidence: digest and
      // parser version included, raw bytes never. Same bytes re-uploaded land
      // on the same path, so retention is idempotent with the ingest.
      if (parsed.kind === 'swiggy-annexure' && parsed.cycles[0]) {
        const cycle = parsed.cycles[0]
        const path = `${cycle.outlet_id}/swiggy/${digestHex.slice(0, 32)}.json`
        await service.storage
          .from('operator-statements')
          .upload(
            path,
            JSON.stringify({ parser: PARSE_VERSION, digest: digestHex, candidate: cycle }),
            { contentType: 'application/json', upsert: true },
          )
        results.push({ evidence_path: path })
      }
    }
  } catch (cause) {
    console.error('ingest failed', cause)
    return json({ error: 'ingest_failed' }, 500)
  }

  return json({ kind: parsed.kind, results }, 200)
})
