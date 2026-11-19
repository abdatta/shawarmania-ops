/**
 * The sender's way into the database: signed in as the owner, and the real
 * `CampaignQueue` over the campaign functions (design D4, D6).
 *
 * **It signs in as a person, with no new kind of credential** (D4). The owner
 * types a username or email and a password once, in the terminal; supabase-js
 * keeps the session in one file in the sender's folder and refreshes it, so
 * every call is an owner's call and the database refuses it for anybody else.
 * The service-role key is never on the laptop.
 *
 * Which database is written down beside the session, in `queue.json`: its
 * address and its public key, both of which the app itself ships to every
 * browser. Neither is a secret; the session file is.
 *
 * Nothing CI runs imports this file: it needs a database. What it reads and
 * writes is `core/queue-answers.ts`, which the root test run covers.
 */

import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'

import { usernameToAuthAlias } from '../../../shared/username.ts'

import type { BatchReleaser, CampaignQueue } from './core/contracts.ts'
import { queueSessionPath } from './core/data-folder.ts'
import { addressInScript, scriptsOfPage } from './core/site-address.ts'
import {
  readClaim,
  readFinishNotices,
  readMessageIds,
  readTestClaim,
  readTick,
  receiptArguments,
  reportArguments,
} from './core/queue-answers.ts'

/**
 * The database a published app talks to, read from the app's own script, as a
 * browser reads it (`core/site-address.ts`). Null when the site cannot be
 * reached or does not carry exactly one project's address and public key.
 */
export async function addressFromSite(site: string): Promise<QueueAddress | null> {
  try {
    const page = await fetch(site, { signal: AbortSignal.timeout(15_000) })
    for (const script of scriptsOfPage(await page.text(), site)) {
      const found = addressInScript(
        await (await fetch(script, { signal: AbortSignal.timeout(15_000) })).text(),
      )
      if (found) return found
    }
  } catch {
    // Unreachable: said by the caller.
  }
  return null
}

/** The production project. A sender pointed at it is the real thing. */
export const PRODUCTION_REF = 'iefcidjbfnmsiqithqbj'

export interface QueueAddress {
  url: string
  anonKey: string
}

function configPath(folder: string): string {
  return join(folder, 'queue.json')
}

function writeWhole(path: string, text: string): void {
  const temporary = `${path}.tmp`
  writeFileSync(temporary, text, 'utf8')
  renameSync(temporary, path)
}

export function readQueueAddress(folder: string): QueueAddress | null {
  try {
    const parsed = JSON.parse(readFileSync(configPath(folder), 'utf8')) as Partial<QueueAddress>
    if (typeof parsed.url === 'string' && typeof parsed.anonKey === 'string') {
      return { url: parsed.url, anonKey: parsed.anonKey }
    }
  } catch {
    // No address yet.
  }
  return null
}

export function isProduction(address: QueueAddress): boolean {
  return address.url.includes(PRODUCTION_REF)
}

/** Which database, in words, without the address itself. */
export function databaseName(address: QueueAddress): string {
  if (isProduction(address)) return 'production'
  if (/127\.0\.0\.1|localhost/.test(address.url)) return 'the local database on this laptop'
  return 'staging (or another project that is not production)'
}

/** supabase-js keeps its session through this: one file, saved whole. */
function sessionStore(folder: string) {
  const path = queueSessionPath(folder)
  const read = (): Record<string, string> => {
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>
    } catch {
      return {}
    }
  }
  return {
    getItem: (key: string) => read()[key] ?? null,
    setItem: (key: string, value: string) => {
      mkdirSync(folder, { recursive: true })
      writeWhole(path, JSON.stringify({ ...read(), [key]: value }))
    },
    removeItem: (key: string) => {
      const kept = read()
      delete kept[key]
      if (Object.keys(kept).length === 0) rmSync(path, { force: true })
      else writeWhole(path, JSON.stringify(kept))
    },
  }
}

function clientFor(folder: string, address: QueueAddress): SupabaseClient {
  return createClient(address.url, address.anonKey, {
    auth: {
      storage: sessionStore(folder),
      storageKey: 'campaign-sender',
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  })
}

/** An email as typed; a username through its reserved alias, as the app signs one in. */
function loginEmail(login: string): string | null {
  const trimmed = login.trim()
  return trimmed.includes('@') ? trimmed : usernameToAuthAlias(trimmed)
}

export type SignInResult =
  { ok: true } | { ok: false; why: 'refused' | 'not_an_owner' | 'unreachable' }

/**
 * Signs in, keeps the session, and proves it is an owner's by asking the one
 * owner-only question that changes nothing. A session that is not an owner's
 * is signed out again at once and not kept.
 */
export async function signIn(
  folder: string,
  address: QueueAddress,
  login: string,
  password: string,
): Promise<SignInResult> {
  mkdirSync(folder, { recursive: true })
  writeWhole(configPath(folder), `${JSON.stringify(address, null, 2)}\n`)
  const email = loginEmail(login)
  if (!email) return { ok: false, why: 'refused' }
  const client = clientFor(folder, address)
  const signed = await client.auth.signInWithPassword({ email, password }).catch(() => null)
  if (!signed) return { ok: false, why: 'unreachable' }
  if (signed.error || !signed.data.session) return { ok: false, why: 'refused' }
  const probe = await client.rpc('campaign_outstanding_message_ids')
  if (probe.error) {
    await client.auth.signOut({ scope: 'local' })
    return { ok: false, why: 'not_an_owner' }
  }
  return { ok: true }
}

export async function signOut(folder: string): Promise<void> {
  const address = readQueueAddress(folder)
  if (address)
    await clientFor(folder, address)
      .auth.signOut({ scope: 'local' })
      .catch(() => {})
  rmSync(queueSessionPath(folder), { force: true })
}

/** The signed-in client, or null when there is no session here to use. */
export async function signedInClient(folder: string): Promise<SupabaseClient | null> {
  const address = readQueueAddress(folder)
  if (!address || !existsSync(queueSessionPath(folder))) return null
  const client = clientFor(folder, address)
  const { data } = await client.auth.getSession()
  return data.session ? client : null
}

/** This laptop's name to the database, made once (D12: a second sender stands down). */
export function installationId(folder: string): string {
  const path = join(folder, 'installation-id')
  try {
    const id = readFileSync(path, 'utf8').trim()
    if (id) return id
  } catch {
    // Made below.
  }
  const id = randomUUID()
  mkdirSync(folder, { recursive: true })
  writeFileSync(path, `${id}\n`, 'utf8')
  return id
}

async function call(client: SupabaseClient, fn: string, args?: Record<string, unknown>) {
  const { data, error } = await client.rpc(fn, args)
  if (error) throw new Error(`${fn}: ${error.message}`)
  return data as unknown
}

/**
 * The real queue. Every method is one function call, and one that fails
 * rejects, which the loop treats as the database being out of reach: it sends
 * nothing and asks again later.
 *
 * @param linkedLast4 the linked number's last four digits, once WhatsApp is up.
 */
export function databaseQueue(
  client: SupabaseClient,
  installation: string,
  linkedLast4: () => string | null,
): CampaignQueue & BatchReleaser {
  return {
    tick: async (status, haltReason) =>
      readTick(
        await call(client, 'campaign_sender_tick', {
          p_status: status,
          p_halt_reason: haltReason ?? null,
          p_installation_id: installation,
          p_linked_number_last4: linkedLast4(),
        }),
      ),
    claimNext: async (batch) =>
      readClaim(
        await call(client, 'campaign_claim_next', {
          p_campaign_id: batch.campaignId,
          p_batch_no: batch.batchNo,
        }),
      ),
    claimNextTest: async () => readTestClaim(await call(client, 'campaign_claim_next_test')),
    report: async (ref, result) => {
      const { fn, args } = reportArguments(ref, result)
      return (await call(client, fn, args)) === true
    },
    releaseStaleClaims: async () => {
      const released = await call(client, 'campaign_release_stale_claims')
      return typeof released === 'number' ? released : 0
    },
    reportReceipts: async (receipts) => {
      await call(client, 'campaign_report_receipts', { p_receipts: receiptArguments(receipts) })
    },
    outstandingMessageIds: async () =>
      readMessageIds(await call(client, 'campaign_outstanding_message_ids')),
    pauseCampaign: async (campaignId, reason) => {
      await call(client, 'pause_campaign', { p_campaign_id: campaignId, p_reason: reason })
    },
    recordStop: async (phoneDigits) =>
      (await call(client, 'campaign_record_stop', { p_phone: phoneDigits })) === true,
    finishNotices: async () => readFinishNotices(await call(client, 'campaign_finish_notices')),
    markFinishNotice: async (campaignId) => {
      await call(client, 'campaign_mark_finish_notice', { p_campaign_id: campaignId })
    },
    releaseBatch: async (batch) =>
      (await call(client, 'release_campaign_batch', {
        p_campaign_id: batch.campaignId,
        p_batch_no: batch.batchNo,
      })) === true,
  }
}

/**
 * A campaign's picture, downloaded with the owner's session and kept: its path
 * never changes once a campaign is submitted, so it is fetched once per
 * campaign, not once per message (design, The database, built).
 */
export function pictureCache(client: SupabaseClient): (path: string) => Promise<Buffer> {
  const kept = new Map<string, Promise<Buffer>>()
  return (path) => {
    let picture = kept.get(path)
    if (!picture) {
      picture = client.storage
        .from('campaign-images')
        .download(path)
        .then(async ({ data, error }) => {
          if (error || !data) throw new Error('The picture could not be downloaded.')
          return Buffer.from(await data.arrayBuffer())
        })
      // A failed download is tried again next time, not remembered.
      picture.catch(() => kept.delete(path))
      kept.set(path, picture)
    }
    return picture
  }
}
