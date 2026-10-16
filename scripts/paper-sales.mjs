#!/usr/bin/env node
/**
 * Enter sales taken on paper (a-sale-taken-on-paper-says-so, #77).
 *
 *   node --env-file=.env.paper scripts/paper-sales.mjs <orders.csv> --target staging
 *   node --env-file=.env.paper scripts/paper-sales.mjs <orders.csv> --target staging --commit
 *   node --env-file=.env.paper scripts/paper-sales.mjs <orders.csv> --target staging --undo --reason "…"
 *
 * One row per written order. Without `--commit` nothing is written: the script
 * signs in, resolves every dish against the outlet's menu, works out each bill,
 * and prints the day's totals by tender — the figures to hold against the
 * sheet's own totals and the UPI app — and how many orders are already
 * recorded. `--commit` records them through `record_paper_bill`, one call per
 * order, stopping at the first refusal; run it again and it carries on, because
 * each order's bill id is derived from its outlet and its order key. `--undo`
 * cancels the file's recorded bills through the ordinary void, and is dry until
 * `--commit` too.
 *
 * It signs in as the person entering, so every bill names them. It never uses
 * the service-role key: a service-role call has nobody to record as the
 * enterer, and the database refuses it.
 *
 * Environment (keep it in an untracked file and pass it with --env-file):
 *   PAPER_SALES_SUPABASE_URL   the project's API URL
 *   PAPER_SALES_ANON_KEY       the project's public anon key
 *   PAPER_SALES_LOGIN          your email, or your username
 *   PAPER_SALES_PASSWORD       your password
 *
 * The CSV's header names its columns, in any order:
 *   order_key      unique per written order, e.g. puja26-d1-p2-07 (day, page, line)
 *   outlet         the outlet's short code, e.g. kalyani
 *   business_date  YYYY-MM-DD, the trading day the order belongs to
 *   time           HH:MM, Kolkata; after midnight but before the day ends, the
 *                  calendar date is the next day and the script works that out
 *   items          dishes separated by `;`, each `Name*quantity`, optionally
 *                  `@price` in rupees when it differs from today's menu, and
 *                  ` free` when it was given away: `Classic Chicken Shawarma*2;
 *                  Mayonnaise Chicken Shawarma*1@150; Classic Chicken Shawarma*1 free`
 *   cash, upi      rupees taken in each; blank is nothing
 *   discount       optional, rupees off the whole bill
 *   phone, name    optional, the customer's
 *
 * Full runbook: docs/OPERATIONS.md, "A day traded on paper".
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const PRODUCTION_REF = 'iefcidjbfnmsiqithqbj'

/** Bill ids are UUIDv5 under this namespace, from `<outlet id>:<order key>`. */
export const PAPER_BILL_NAMESPACE = '6f9b2f3e-77a1-4c5e-9d0b-0a5e7b2c7701'

// ── Parsing ────────────────────────────────────────────────────────────────

/** RFC 4180-ish: quoted fields, doubled quotes, CRLF or LF. */
export function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  const nonEmpty = rows.filter((r) => r.some((cell) => cell.trim() !== ''))
  if (nonEmpty.length === 0) return []
  const header = nonEmpty[0].map((h) => h.trim().toLowerCase())
  for (const required of ['order_key', 'outlet', 'business_date', 'time', 'items']) {
    if (!header.includes(required)) throw new Error(`The CSV has no "${required}" column.`)
  }
  return nonEmpty.slice(1).map((cells, index) => {
    const record = { line: index + 2 }
    header.forEach((name, column) => {
      record[name] = (cells[column] ?? '').trim()
    })
    return record
  })
}

/** Rupees as written (`150`, `150.50`, blank) to integer paise. */
export function rupeesToPaise(text, what) {
  const value = (text ?? '').trim()
  if (value === '') return 0
  if (!/^\d+(\.\d{1,2})?$/.test(value))
    throw new Error(`${what} "${value}" is not an amount in rupees.`)
  const [whole, fraction = ''] = value.split('.')
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
}

/** `Name*2@150 free; Other*1` → [{ name, quantity, pricePaise|null, free }]. */
export function parseItems(text) {
  const parts = (text ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length === 0) throw new Error('An order needs at least one dish.')
  return parts.map((part) => {
    const match = /^(.+?)\s*\*\s*(\d{1,3})\s*(?:@\s*(\d+(?:\.\d{1,2})?))?\s*(free)?$/i.exec(part)
    if (!match) {
      throw new Error(`"${part}" is not "Dish*quantity", "Dish*quantity@price" or "… free".`)
    }
    const quantity = Number(match[2])
    if (quantity < 1) throw new Error(`"${part}" has no quantity.`)
    return {
      name: match[1].trim(),
      quantity,
      pricePaise: match[3] === undefined ? null : rupeesToPaise(match[3], 'Price'),
      free: Boolean(match[4]),
    }
  })
}

// ── Identity and time ──────────────────────────────────────────────────────

export function uuidv5(name, namespace = PAPER_BILL_NAMESPACE) {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex')
  const hash = createHash('sha1').update(ns).update(Buffer.from(name, 'utf8')).digest()
  hash[6] = (hash[6] & 0x0f) | 0x50
  hash[8] = (hash[8] & 0x3f) | 0x80
  const hex = hash.subarray(0, 16).toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function paperBillId(outletId, orderKey) {
  return uuidv5(`${outletId}:${orderKey}`)
}

/**
 * The instant a written order was taken. A time before the outlet's cutover
 * belongs to the business day that started the evening before, so its calendar
 * date is the next one: 01:30 on business day the 19th is the 20th at 01:30.
 */
export function orderedAt(businessDate, time, cutover = '04:00') {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) {
    throw new Error(`business_date "${businessDate}" is not YYYY-MM-DD.`)
  }
  const match = /^(\d{1,2}):(\d{2})$/.exec(time)
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) {
    throw new Error(`time "${time}" is not HH:MM.`)
  }
  const hhmm = `${match[1].padStart(2, '0')}:${match[2]}`
  const nextDay = hhmm < cutover.slice(0, 5)
  const date = new Date(`${businessDate}T00:00:00Z`)
  if (nextDay) date.setUTCDate(date.getUTCDate() + 1)
  return `${date.toISOString().slice(0, 10)}T${hhmm}:00+05:30`
}

// ── Planning ───────────────────────────────────────────────────────────────

/**
 * Every row to the payload `record_paper_bill` takes, with the totals the
 * database will arrive at, or the reason it would refuse. Money is integer
 * paise throughout; the total rounds up to the rupee, as at the counter.
 *
 * `outlets` is [{ id, code, business_day_cutover }]; `menus` maps an outlet id
 * to its active items, [{ id, name, price_paise }].
 */
export function planOrders(records, outlets, menus) {
  const seen = new Set()
  return records.map((record) => {
    const base = { line: record.line, orderKey: record.order_key }
    try {
      if (!record.order_key) throw new Error('order_key is blank.')
      const outlet = outlets.find((o) => o.code.toLowerCase() === record.outlet.toLowerCase())
      if (!outlet) throw new Error(`No outlet has the code "${record.outlet}".`)
      const key = `${outlet.id}:${record.order_key}`
      if (seen.has(key)) throw new Error(`order_key "${record.order_key}" appears twice.`)
      seen.add(key)

      const menu = menus.get(outlet.id) ?? []
      let subtotal = 0
      let lineDiscounts = 0
      let items = 0
      const lines = parseItems(record.items).map((item) => {
        const matches = menu.filter((m) => m.name.toLowerCase() === item.name.toLowerCase())
        if (matches.length === 0) throw new Error(`"${item.name}" is not on ${outlet.code}'s menu.`)
        if (matches.length > 1) throw new Error(`"${item.name}" names two dishes on the menu.`)
        const dish = matches[0]
        const price = item.pricePaise ?? dish.price_paise
        if (price < 1) throw new Error(`"${item.name}" needs a price; mark it free instead.`)
        const total = price * item.quantity
        subtotal += total
        items += item.quantity
        if (item.free) lineDiscounts += total
        return {
          menuItemId: dish.id,
          quantity: item.quantity,
          ...(item.pricePaise === null ? {} : { unitPricePaise: price }),
          ...(item.free ? { discountPaise: total } : {}),
        }
      })
      const billDiscount = rupeesToPaise(record.discount, 'discount')
      const raw = subtotal - lineDiscounts - billDiscount
      if (raw < 1) {
        throw new Error('It comes to nothing. An order given away entirely cannot be a bill.')
      }
      const totalPaise = raw + ((100 - (raw % 100)) % 100)
      const cash = rupeesToPaise(record.cash, 'cash')
      const upi = rupeesToPaise(record.upi, 'upi')
      if (cash + upi !== totalPaise) {
        throw new Error(
          `Cash ${rupees(cash)} and UPI ${rupees(upi)} make ${rupees(cash + upi)}, but the order comes to ${rupees(totalPaise)}.`,
        )
      }
      const payments = [
        ...(cash > 0 ? [{ method: 'cash', amountPaise: cash }] : []),
        ...(upi > 0 ? [{ method: 'upi', amountPaise: upi }] : []),
      ]
      const payload = {
        businessDate: record.business_date,
        orderedAt: orderedAt(record.business_date, record.time, outlet.business_day_cutover),
        lines,
        payments,
        ...(billDiscount > 0 ? { discountPaise: billDiscount } : {}),
        ...(record.phone ? { customerPhone: record.phone } : {}),
        ...(record.name ? { customerName: record.name } : {}),
      }
      return {
        ...base,
        ok: true,
        outletId: outlet.id,
        outletCode: outlet.code,
        billId: paperBillId(outlet.id, record.order_key),
        payload,
        items,
        cashPaise: cash,
        upiPaise: upi,
        discountPaise: lineDiscounts + billDiscount,
        totalPaise,
      }
    } catch (error) {
      return { ...base, ok: false, error: error.message }
    }
  })
}

export function rupees(paise) {
  const sign = paise < 0 ? '-' : ''
  const abs = Math.abs(paise)
  const whole = Math.floor(abs / 100)
  const fraction = abs % 100
  return `${sign}₹${whole.toLocaleString('en-IN')}${fraction ? `.${String(fraction).padStart(2, '0')}` : ''}`
}

/** Totals per outlet and business day, for the dry run. */
export function summarise(plans, recordedIds = new Set()) {
  const days = new Map()
  for (const plan of plans) {
    if (!plan.ok) continue
    const key = `${plan.outletCode} ${plan.payload.businessDate}`
    const day = days.get(key) ?? {
      outlet: plan.outletCode,
      businessDate: plan.payload.businessDate,
      orders: 0,
      items: 0,
      cashPaise: 0,
      upiPaise: 0,
      discountPaise: 0,
      totalPaise: 0,
      alreadyRecorded: 0,
    }
    day.orders += 1
    day.items += plan.items
    day.cashPaise += plan.cashPaise
    day.upiPaise += plan.upiPaise
    day.discountPaise += plan.discountPaise
    day.totalPaise += plan.totalPaise
    if (recordedIds.has(plan.billId)) day.alreadyRecorded += 1
    days.set(key, day)
  }
  return [...days.values()].sort(
    (a, b) => a.outlet.localeCompare(b.outlet) || a.businessDate.localeCompare(b.businessDate),
  )
}

/**
 * Where the script may write, or why not. Production only when asked for by
 * name, and never a key that is not the public anon key.
 */
export function checkTarget({ url, anonKey, target }) {
  if (!url || !anonKey) {
    throw new Error('Set PAPER_SALES_SUPABASE_URL and PAPER_SALES_ANON_KEY (see the header).')
  }
  if (!['local', 'staging', 'production'].includes(target)) {
    throw new Error('Pass --target local, --target staging or --target production.')
  }
  const isProduction = url.toLowerCase().includes(PRODUCTION_REF)
  if (isProduction && target !== 'production') {
    throw new Error(`PAPER_SALES_SUPABASE_URL is production, but --target is ${target}.`)
  }
  if (!isProduction && target === 'production') {
    throw new Error('--target production, but PAPER_SALES_SUPABASE_URL is not production.')
  }
  if (jwtRole(anonKey) === 'service_role' || anonKey.startsWith('sb_secret_')) {
    throw new Error('That is a service-role key. Use the anon key and your own sign-in.')
  }
}

/** The role a legacy JWT-shaped key claims, or null for any other shape. */
function jwtRole(key) {
  try {
    return JSON.parse(Buffer.from(key.split('.')[1] ?? '', 'base64url').toString('utf8')).role
  } catch {
    return null
  }
}

// ── Running ────────────────────────────────────────────────────────────────

function argValue(args, name) {
  const index = args.indexOf(name)
  return index === -1 ? undefined : args[index + 1]
}

async function main(args) {
  const file = args.find(
    (arg) =>
      !arg.startsWith('--') &&
      args[args.indexOf(arg) - 1] !== '--target' &&
      args[args.indexOf(arg) - 1] !== '--reason',
  )
  if (!file) throw new Error('Name the CSV of orders. See the header of scripts/paper-sales.mjs.')
  const commit = args.includes('--commit')
  const undo = args.includes('--undo')
  const reason = argValue(args, '--reason')?.trim()
  if (undo && !reason) throw new Error('--undo needs --reason "<why>".')
  const target = argValue(args, '--target')
  const url = process.env['PAPER_SALES_SUPABASE_URL']
  const anonKey = process.env['PAPER_SALES_ANON_KEY']
  checkTarget({ url, anonKey, target })

  const { createClient } = await import('@supabase/supabase-js')
  const { usernameToAuthAlias } = await import('../shared/username.ts')
  const client = createClient(url, anonKey, { auth: { persistSession: false } })
  const login = process.env['PAPER_SALES_LOGIN'] ?? ''
  const email = login.includes('@') ? login : usernameToAuthAlias(login)
  if (!email || !process.env['PAPER_SALES_PASSWORD']) {
    throw new Error('Set PAPER_SALES_LOGIN and PAPER_SALES_PASSWORD (see the header).')
  }
  const signIn = await client.auth.signInWithPassword({
    email,
    password: process.env['PAPER_SALES_PASSWORD'],
  })
  if (signIn.error) throw new Error(`Could not sign in: ${signIn.error.message}`)

  console.log(`${target.toUpperCase()} · ${url}`)
  console.log(`Signed in as ${login}\n`)

  const records = parseCsv(readFileSync(file, 'utf8'))
  const outletsRead = await client.from('outlets').select('id, code, business_day_cutover')
  if (outletsRead.error) throw new Error(`Could not read outlets: ${outletsRead.error.message}`)
  const outlets = outletsRead.data
  const codes = new Set(records.map((r) => r.outlet.toLowerCase()))
  const menus = new Map()
  for (const outlet of outlets.filter((o) => codes.has(o.code.toLowerCase()))) {
    const menu = await client
      .from('menu_items')
      .select('id, name, price_paise')
      .eq('outlet_id', outlet.id)
      .eq('is_active', true)
    if (menu.error) throw new Error(`Could not read ${outlet.code}'s menu: ${menu.error.message}`)
    menus.set(outlet.id, menu.data)
  }

  const plans = planOrders(records, outlets, menus)
  const ids = plans.filter((p) => p.ok).map((p) => p.billId)
  const recorded = new Map()
  for (let i = 0; i < ids.length; i += 200) {
    const read = await client
      .from('bills')
      .select('id, bill_number, status, entry_source')
      .in('id', ids.slice(i, i + 200))
    if (read.error) throw new Error(`Could not read recorded bills: ${read.error.message}`)
    for (const row of read.data) recorded.set(row.id, row)
  }

  const failures = plans.filter((p) => !p.ok)
  for (const day of summarise(plans, new Set(recorded.keys()))) {
    console.log(
      `${day.outlet} ${day.businessDate}: ${day.orders} orders, ${day.items} items, ` +
        `cash ${rupees(day.cashPaise)}, UPI ${rupees(day.upiPaise)}, ` +
        `discounts ${rupees(day.discountPaise)}, total ${rupees(day.totalPaise)}` +
        (day.alreadyRecorded ? ` (${day.alreadyRecorded} already recorded)` : ''),
    )
  }
  if (failures.length > 0) {
    console.log(`\n${failures.length} row(s) cannot be recorded:`)
    for (const f of failures)
      console.log(`  line ${f.line} (${f.orderKey || 'no key'}): ${f.error}`)
    process.exitCode = 1
    return
  }

  if (undo) {
    const toVoid = plans.filter((p) => recorded.get(p.billId)?.status === 'settled')
    console.log(`\nUndo: ${toVoid.length} recorded bill(s) would be cancelled: "${reason}".`)
    if (!commit) return console.log('Dry run: nothing changed. Add --commit to cancel them.')
    const { createBillingCommand, billingCommandRpcArguments } =
      await import('../shared/billing-command.ts')
    for (const plan of toVoid) {
      const command = await createBillingCommand({
        commandId: uuidv5(`void:${plan.billId}`),
        tabletId: null,
        shiftId: null,
        type: 'void_bill',
        createdAt: new Date().toISOString(),
        payload: { billId: plan.billId, reason },
      })
      const result = await client.rpc('void_billing_bill', billingCommandRpcArguments(command))
      const status = result.data?.status
      if (result.error || (status !== 'accepted' && status !== 'order_not_open')) {
        throw new Error(
          `line ${plan.line} (${plan.orderKey}): ${result.error?.message ?? status ?? 'no answer'}`,
        )
      }
      console.log(`  cancelled bill ${recorded.get(plan.billId).bill_number} (${plan.orderKey})`)
    }
    return console.log('Done.')
  }

  const toRecord = plans.filter((p) => !recorded.has(p.billId))
  console.log(
    `\n${toRecord.length} order(s) to record, ${plans.length - toRecord.length} already recorded.`,
  )
  if (!commit) return console.log('Dry run: nothing written. Add --commit to record them.')
  for (const plan of plans) {
    const result = await client.rpc('record_paper_bill', {
      p_bill_id: plan.billId,
      p_outlet_id: plan.outletId,
      p_payload: plan.payload,
    })
    if (result.error) {
      throw new Error(`line ${plan.line} (${plan.orderKey}) was refused: ${result.error.message}`)
    }
    if (result.data.totalPaise !== plan.totalPaise) {
      throw new Error(
        `line ${plan.line} (${plan.orderKey}): the database recorded ${rupees(result.data.totalPaise)}, expected ${rupees(plan.totalPaise)}.`,
      )
    }
    if (!result.data.replayed) {
      console.log(
        `  bill ${result.data.billNumber} ← ${plan.orderKey} (${rupees(plan.totalPaise)})`,
      )
    }
  }
  console.log('Done.')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`\n${error.message}`)
    process.exitCode = 1
  })
}
