/**
 * The one parser, minus the byte decoding.
 *
 * This file has NO third-party imports, on purpose: it resolves the same way in
 * the Deno Edge Function and in a Node test, so the logic that could be wrong —
 * which order a row belongs to, which date it takes, whether a customer's phone
 * number survives — is shared verbatim and proved once. Turning bytes into rows
 * is a thin decode either side calls before this; a spreadsheet reader is library
 * work and cannot get the business rules wrong, so it is kept out.
 *
 * Recognition is by CONTENT, never by filename. A downloaded statement is
 * commonly renamed, and two of the three accepted shapes are `.xlsx`, so a name
 * decides nothing. Each shape is known by the sheets it carries or the rows
 * inside its archive.
 */

/** Rows of a sheet or CSV, each cell already a string. Dates are `yyyy-mm-dd`. */
export type Rows = string[][]

/** What a decoder hands this core: named sheets, and/or named CSV files. */
export interface DecodedStatement {
  sheets?: Record<string, Rows>
  csv?: Record<string, Rows>
}

/**
 * Which operator outlet a source's own outlet id belongs to.
 *
 * Passed in rather than hard-coded, because it is deployment configuration: the
 * Zomato restaurant ids and the Hyperpure delivery outlet are the account's, not
 * the parser's.
 */
export interface OutletMap {
  /** Zomato restaurant id -> operator outlet uuid. */
  zomatoResIds: Record<string, string>
  /** The operator outlet a Hyperpure delivery is booked against (shared cost). */
  hyperpureOutletId: string
}

export type ParsedStatement =
  | { kind: 'zomato-order-history'; cycles: AggregatorCyclePayload[] }
  | { kind: 'zomato-settlement'; cycles: AggregatorCyclePayload[] }
  | { kind: 'hyperpure-statement'; statement: SupplyStatementPayload }

/** The shape `ingest_aggregator_cycle` accepts, one per outlet. */
export interface AggregatorCyclePayload {
  contract_version: 1
  outlet_id: string
  channel: 'zomato'
  cycle_start: string
  cycle_end: string
  cycle_state: 'provisional' | 'settled'
  stated_payout_paise: number | null
  orders: Array<{
    order_id: string
    placed_at: string
    gross_paise: number
    commission_paise: number | null
    net_paise: number
  }>
  deductions: unknown[]
  cycle_deductions: unknown[]
}

/** The shape `ingest_supply_statement` accepts. */
export interface SupplyStatementPayload {
  contract_version: 1
  outlet_id: string
  source_system: 'hyperpure'
  category: 'Hyperpure'
  orders: Array<{
    order_ref: string
    invoice_date: string
    amount_paise: number
    description: string
    shared_cost: true
  }>
}

export class StatementShapeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StatementShapeError'
  }
}

// --- money -----------------------------------------------------------------

/**
 * Rupees, as a display string, in integer paise — converted exactly once.
 *
 * The multiply is done in paise arithmetic (×100 then round) rather than on the
 * float, so `3774.577392578125` — a value SheetJS really produces from a computed
 * cell — becomes 377458 rather than drifting. A blank is nought; a value that is
 * not a number at all is refused, because a silent nought would understate a cost.
 */
export function toPaise(value: string | number | null | undefined, label: string): number {
  if (value === null || value === undefined || value === '') return 0
  const rupees = typeof value === 'number' ? value : Number(String(value).replace(/[₹,\s]/g, ''))
  if (!Number.isFinite(rupees)) {
    throw new StatementShapeError(`${label} is not a number: ${String(value)}`)
  }
  return Math.round(rupees * 100)
}

// --- dates -----------------------------------------------------------------

const MONTHS: Record<string, string> = {
  january: '01',
  february: '02',
  march: '03',
  april: '04',
  may: '05',
  june: '06',
  july: '07',
  august: '08',
  september: '09',
  october: '10',
  november: '11',
  december: '12',
}

/**
 * A Zomato order-history timestamp: `08:17 PM, August 17 2026`.
 *
 * Returned as a full ISO instant in IST (+05:30), because the trading-day cutover
 * is applied server-side against a real timestamp and a date alone would strand
 * an after-midnight order on the wrong day. This is the third date format the
 * readers handle; the other two live in the private repo.
 */
export function parseOrderHistoryInstant(text: string): string {
  const match = String(text)
    .trim()
    .match(/^(\d{1,2}):(\d{2})\s*(AM|PM),\s*([A-Za-z]+)\s+(\d{1,2})\s+(\d{4})$/i)
  if (!match) throw new StatementShapeError(`unrecognised order-history date: ${text}`)
  const hh = match[1] ?? '',
    mm = match[2] ?? '',
    ampm = match[3] ?? ''
  const monthName = match[4] ?? '',
    day = match[5] ?? '',
    year = match[6] ?? ''
  const month = MONTHS[monthName.toLowerCase()]
  if (!month) throw new StatementShapeError(`unknown month in date: ${text}`)
  let hour = Number(hh) % 12
  if (ampm.toUpperCase() === 'PM') hour += 12
  const hs = String(hour).padStart(2, '0')
  const ds = String(Number(day)).padStart(2, '0')
  return `${year}-${month}-${ds}T${hs}:${mm}:00+05:30`
}

/** A `yyyy-mm-dd` cell as itself, or a thrown error — used for invoice dates. */
export function asDate(value: string, label: string): string {
  const text = String(value).trim().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new StatementShapeError(`${label} is not a yyyy-mm-dd date: ${value}`)
  }
  return text
}

/**
 * A settlement-workbook order timestamp: `2026-08-03 21:14:02`.
 *
 * The cell is a wall-clock Indian time, so +05:30 is appended rather than
 * inferred — an order at 00:30 must land on the previous trading day, which is
 * exactly the case a timezone slip would move. Mirrors the private reader's
 * `toInstant`, which reapplies the same offset for the same reason.
 */
export function parseWorkbookInstant(text: string): string {
  const match = String(text)
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/)
  if (!match) throw new StatementShapeError(`unrecognised settlement date: ${text}`)
  const y = match[1],
    m = match[2],
    d = match[3],
    hh = match[4],
    mm = match[5]
  const ss = match[6] ?? '00'
  return `${y}-${m}-${d}T${hh}:${mm}:${ss}+05:30`
}

// --- helpers ---------------------------------------------------------------

function headerIndex(header: readonly string[], name: string): number {
  const want = name.trim().toLowerCase()
  return header.findIndex((cell) => String(cell).trim().toLowerCase() === want)
}

/** One cell as a string, tolerating a short or ragged row. */
function cell(row: readonly string[], index: number): string {
  return String(row[index] ?? '')
}

/**
 * A column locator: maps each wanted name to its index once, and throws if one
 * is missing. Returning a function rather than a record keeps every later access
 * a plain number, so a ragged row never turns into an undefined index.
 */
function columnLocator(
  header: readonly string[],
  names: string[],
  sheet: string,
): (name: string) => number {
  const found = new Map<string, number>()
  for (const name of names) {
    const index = headerIndex(header, name)
    if (index < 0) throw new StatementShapeError(`sheet ${sheet} has no "${name}" column`)
    found.set(name, index)
  }
  return (name) => found.get(name) ?? -1
}

// --- recognition -----------------------------------------------------------

const KNOWN_SHAPES =
  'Zomato order history (a zip of order_history_*.csv), Zomato settlement (an Order Level sheet), or Hyperpure statement (Overall SOA and Payment Ledger sheets)'

export function recognise(decoded: DecodedStatement): ParsedStatement['kind'] {
  const csvNames = Object.keys(decoded.csv ?? {})
  if (csvNames.some((name) => /order_history_.*\.csv$/i.test(name))) {
    return 'zomato-order-history'
  }
  const sheets = decoded.sheets ?? {}
  const sheetNames = Object.keys(sheets)
  if (sheetNames.some((name) => name.trim().toLowerCase() === 'order level')) {
    return 'zomato-settlement'
  }
  const lower = sheetNames.map((name) => name.trim().toLowerCase())
  if (lower.includes('overall soa') && lower.includes('payment ledger')) {
    return 'hyperpure-statement'
  }
  throw new StatementShapeError(
    `this file matches no known statement shape. Expected one of: ${KNOWN_SHAPES}.`,
  )
}

// --- Hyperpure -------------------------------------------------------------

/**
 * The Overall SOA sheet, one expense per order.
 *
 * An order carries one invoice or several, and they are summed; a credit note
 * against the order reduces it. The count of invoices is never assumed — ten of a
 * hundred orders have only one — so the row is keyed on the order number and its
 * invoices are added up however many there are. Every order books against one
 * operator outlet as a shared cost, because the whole account delivers to one
 * address and both kitchens draw on it.
 */
export function parseHyperpure(
  decoded: DecodedStatement,
  outlets: OutletMap,
): SupplyStatementPayload {
  const soa = decoded.sheets?.['Overall SOA'] ?? decoded.sheets?.['overall soa']
  if (!soa) throw new StatementShapeError('the Hyperpure statement has no Overall SOA sheet')

  // The header is not row 1: rows above it are a summary block. Find the row that
  // names the invoice columns rather than trusting a fixed offset.
  const headerRow = soa.findIndex(
    (row) =>
      row.some((cell) => String(cell).trim().toLowerCase() === 'order number') &&
      row.some((cell) => String(cell).trim().toLowerCase() === 'invoice date'),
  )
  if (headerRow < 0) throw new StatementShapeError('the Overall SOA sheet has no invoice header')

  const header = soa[headerRow] ?? []
  const at = columnLocator(
    header,
    ['Order number', 'Invoice Date', 'Invoice Amt', 'Credit Note Amt'],
    'Overall SOA',
  )

  const byOrder = new Map<string, { invoice_date: string; amount_paise: number }>()
  for (let r = headerRow + 1; r < soa.length; r += 1) {
    const row = soa[r]
    if (!row) continue
    const orderRef = cell(row, at('Order number')).trim()
    if (!orderRef) continue

    const invoiceDate = asDate(cell(row, at('Invoice Date')), 'Invoice Date')
    const invoice = toPaise(cell(row, at('Invoice Amt')), 'Invoice Amt')
    const creditNote = toPaise(cell(row, at('Credit Note Amt')), 'Credit Note Amt')

    const existing = byOrder.get(orderRef)
    if (existing) {
      existing.amount_paise += invoice - creditNote
      // The earliest invoice date of an order is the day its goods arrived.
      if (invoiceDate < existing.invoice_date) existing.invoice_date = invoiceDate
    } else {
      byOrder.set(orderRef, { invoice_date: invoiceDate, amount_paise: invoice - creditNote })
    }
  }

  const orders = [...byOrder.entries()].map(([order_ref, o]) => ({
    order_ref,
    invoice_date: o.invoice_date,
    amount_paise: o.amount_paise,
    description: `Hyperpure ${order_ref}`,
    shared_cost: true as const,
  }))

  return {
    contract_version: 1,
    outlet_id: outlets.hyperpureOutletId,
    source_system: 'hyperpure',
    category: 'Hyperpure',
    orders,
  }
}

// --- Zomato order history --------------------------------------------------

/**
 * The order-history CSV, grouped into a provisional cycle per outlet.
 *
 * The export carries no commission, so every order arrives with commission
 * undetermined and the cycle is provisional: it says what came in and cannot say
 * what was kept until the week settles. The revenue basis is `Bill subtotal +
 * Packaging charges`, which is the commissionable value; the customer identifier
 * and phone columns are never read, so no personal data can leave this function
 * even by accident.
 */
export function parseOrderHistory(
  decoded: DecodedStatement,
  outlets: OutletMap,
): AggregatorCyclePayload[] {
  const entry = Object.entries(decoded.csv ?? {}).find(([name]) =>
    /order_history_.*\.csv$/i.test(name),
  )
  if (!entry) throw new StatementShapeError('the archive has no order_history CSV')
  const rows = entry[1]
  if (rows.length < 2) return []

  const header = rows[0] ?? []
  const at = columnLocator(
    header,
    [
      'Restaurant ID',
      'Order ID',
      'Order Placed At',
      'Order Status',
      'Bill subtotal',
      'Packaging charges',
    ],
    'order history',
  )

  const byOutlet = new Map<string, AggregatorCyclePayload['orders']>()
  const dates: string[] = []
  for (let r = 1; r < rows.length; r += 1) {
    const row = rows[r]
    if (!row) continue
    const resId = cell(row, at('Restaurant ID')).trim()
    const outletId = outlets.zomatoResIds[resId]
    if (!outletId) continue // a restaurant this account does not run

    const placedAt = parseOrderHistoryInstant(cell(row, at('Order Placed At')))
    dates.push(placedAt.slice(0, 10))
    const gross =
      toPaise(cell(row, at('Bill subtotal')), 'Bill subtotal') +
      toPaise(cell(row, at('Packaging charges')), 'Packaging charges')

    const order = {
      order_id: cell(row, at('Order ID')).trim(),
      placed_at: placedAt,
      gross_paise: gross,
      commission_paise: null,
      net_paise: gross, // net is undetermined until commission is; gross stands in
    }
    const list = byOutlet.get(outletId) ?? []
    list.push(order)
    byOutlet.set(outletId, list)
  }

  const cycleStart = dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : ''
  const cycleEnd = dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : ''

  return [...byOutlet.entries()].map(([outlet_id, orders]) => ({
    contract_version: 1,
    outlet_id,
    channel: 'zomato',
    cycle_start: cycleStart,
    cycle_end: cycleEnd,
    cycle_state: 'provisional',
    stated_payout_paise: null,
    orders,
    deductions: [],
    cycle_deductions: [],
  }))
}

// --- Zomato settlement -----------------------------------------------------

/**
 * The Order Level sheet, a settled cycle per outlet.
 *
 * The column semantics are the private reader's, ported rather than guessed: the
 * header is row 7, data starts at row 8, a `#REF!` template row is skipped, and
 * the authoritative net is the "Order level Payout" column — which includes the
 * cancellation refunds the dashboard omits — while the revenue is "Commissionable
 * value", so commission is the difference. Columns are matched by name, so the
 * other fifty-odd are ignored and a layout change breaks loudly rather than
 * reconciling against the wrong column.
 *
 * The stated payout is the sum of the order-level payouts, because the workbook is
 * the settled truth: it is what Zomato paid, per order, so the cycle reconciles
 * against itself. The gate that catches a stated-versus-computed mismatch belongs
 * to the live path, where the two come from different places.
 */
export function parseZomatoSettlement(
  decoded: DecodedStatement,
  outlets: OutletMap,
): AggregatorCyclePayload[] {
  const sheet =
    decoded.sheets?.['Order Level'] ??
    decoded.sheets?.[
      Object.keys(decoded.sheets ?? {}).find((n) => n.trim().toLowerCase() === 'order level') ?? ''
    ]
  if (!sheet) throw new StatementShapeError('the settlement workbook has no Order Level sheet')

  // Header is row 7 (index 6); tolerate a shifted title block by searching near it.
  let headerRow = 6
  const looksLikeHeader = (row: Rows[number] | undefined) =>
    !!row && row.some((c) => /^order id$/i.test(String(c).trim()))
  if (!looksLikeHeader(sheet[headerRow])) {
    headerRow = sheet.findIndex(looksLikeHeader)
    if (headerRow < 0) throw new StatementShapeError('the Order Level sheet has no Order ID header')
  }

  const header = sheet[headerRow] ?? []
  const find = (pattern: RegExp) =>
    header.findIndex((c) => pattern.test(String(c).replace(/\s+/g, ' ').trim()))
  const cols = {
    orderId: find(/^Order ID$/i),
    orderedAt: find(/^Order Date$/i),
    resId: find(/^Res\.? ID$/i),
    payout: find(/^Order level Payout/i),
    commissionable: find(/^Commissionable value/i),
  }
  const missing = Object.entries(cols)
    .filter(([, i]) => i < 0)
    .map(([k]) => k)
  if (missing.length) {
    throw new StatementShapeError(`the Order Level sheet is missing columns: ${missing.join(', ')}`)
  }

  const byOutlet = new Map<
    string,
    { orders: AggregatorCyclePayload['orders']; dates: string[]; payout: number }
  >()
  for (let r = headerRow + 1; r < sheet.length; r += 1) {
    const row = sheet[r]
    if (!row) continue
    const orderId = cell(row, cols.orderId).trim()
    if (!orderId || orderId.includes('#REF')) continue

    const resId = cell(row, cols.resId).trim()
    const outletId = outlets.zomatoResIds[resId]
    if (!outletId) continue

    const placedAt = parseWorkbookInstant(cell(row, cols.orderedAt))
    const gross = toPaise(cell(row, cols.commissionable), 'Commissionable value')
    const net = toPaise(cell(row, cols.payout), 'Order level Payout')

    const bucket = byOutlet.get(outletId) ?? { orders: [], dates: [], payout: 0 }
    bucket.orders.push({
      order_id: orderId,
      placed_at: placedAt,
      gross_paise: gross,
      commission_paise: gross - net,
      net_paise: net,
    })
    bucket.dates.push(placedAt.slice(0, 10))
    bucket.payout += net
    byOutlet.set(outletId, bucket)
  }

  return [...byOutlet.entries()].map(([outlet_id, b]) => ({
    contract_version: 1,
    outlet_id,
    channel: 'zomato',
    cycle_start: b.dates.reduce((a, c) => (a < c ? a : c)),
    cycle_end: b.dates.reduce((a, c) => (a > c ? a : c)),
    cycle_state: 'settled',
    stated_payout_paise: b.payout,
    orders: b.orders,
    deductions: [],
    cycle_deductions: [],
  }))
}

// --- entry -----------------------------------------------------------------

/** Recognise a decoded statement and shape it for the ingest it belongs to. */
export function parseStatement(decoded: DecodedStatement, outlets: OutletMap): ParsedStatement {
  const kind = recognise(decoded)
  if (kind === 'hyperpure-statement') {
    return { kind, statement: parseHyperpure(decoded, outlets) }
  }
  if (kind === 'zomato-order-history') {
    return { kind, cycles: parseOrderHistory(decoded, outlets) }
  }
  return { kind: 'zomato-settlement', cycles: parseZomatoSettlement(decoded, outlets) }
}
