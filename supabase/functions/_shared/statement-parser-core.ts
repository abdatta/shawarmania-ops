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
 * Compatibility identifiers copied into version-1 payloads.
 *
 * Zomato still routes by its restaurant id. Hyperpure is different: its value
 * only keeps old and new deployments interoperable; the database resolves each
 * order from effective-dated delivery routes and never trusts this field.
 */
export interface OutletMap {
  /** Zomato restaurant id -> operator outlet uuid. */
  zomatoResIds: Record<string, string>
  /** Legacy value for the version-1 field; never Hyperpure routing authority. */
  hyperpureCompatibilityOutletId: string
  /** Swiggy portal restaurant reference -> operator outlet uuid. */
  swiggyRefs?: Record<string, string>
}

export type ParsedStatement =
  | { kind: 'zomato-order-history'; cycles: AggregatorCyclePayload[] }
  | { kind: 'zomato-settlement'; cycles: AggregatorCyclePayload[] }
  | { kind: 'hyperpure-statement'; statement: SupplyStatementPayload }
  | { kind: 'swiggy-annexure'; cycles: AggregatorCyclePayload[] }
  | { kind: 'swiggy-metrics-evidence'; days: SwiggyMetricsDay[] }

/** One calendar-day reading from a Business Metrics Report: evidence, never a ledger write. */
export interface SwiggyMetricsDay {
  restaurant_ref: string
  calendar_date: string
  net_sales_paise: number
}

/** The shape `ingest_aggregator_cycle` accepts, one per outlet. */
export interface AggregatorCyclePayload {
  contract_version: 1
  outlet_id: string
  channel: 'zomato' | 'swiggy'
  restaurant_ref?: string
  operator_cycle_ref?: string
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
  'Zomato order history (a zip of order_history_*.csv), Zomato payout workbook (Order Level, Addition Deductions Details and HSummary sheets), Hyperpure statement (Overall SOA and Payment Ledger sheets), Swiggy payout annexure (Summary and Payout Breakup sheets), or a Swiggy Business Metrics Report'

export function recognise(decoded: DecodedStatement): ParsedStatement['kind'] {
  const csvNames = Object.keys(decoded.csv ?? {})
  if (csvNames.some((name) => /order_history_.*\.csv$/i.test(name))) {
    return 'zomato-order-history'
  }
  const sheets = decoded.sheets ?? {}
  const sheetNames = Object.keys(sheets)
  const lower = sheetNames.map((name) => name.trim().toLowerCase())
  // A Zomato payout workbook and a Swiggy annexure BOTH carry "Summary",
  // "Payout Breakup" and "Order Level". Only Zomato's carries "Addition
  // Deductions Details" and the hidden "HSummary" (measured on real files from
  // both, 2026-09-30), so it is recognised by those first. Until then every real
  // Zomato workbook was read as a Swiggy annexure and refused as one.
  if (
    lower.includes('order level') &&
    (lower.includes('addition deductions details') || lower.includes('hsummary'))
  ) {
    return 'zomato-settlement'
  }
  if (lower.includes('summary') && lower.includes('payout breakup')) {
    return 'swiggy-annexure'
  }
  if (
    sheetNames.some((name) => {
      const rows = sheets[name] ?? []
      return rows.some(
        (row) =>
          row.some((value) => String(value).trim().toLowerCase() === 'overview') &&
          row.some((value) => String(value).trim().toLowerCase() === 'metric'),
      )
    })
  ) {
    // Calendar-day evidence about the portal's own numbers. It names no
    // business window, so it can never become a ledger write; it is returned
    // only so the caller can say what a file was rather than failing blankly.
    return 'swiggy-metrics-evidence'
  }
  if (sheetNames.some((name) => name.trim().toLowerCase() === 'order level')) {
    return 'zomato-settlement'
  }
  if (lower.includes('overall soa') && lower.includes('payment ledger')) {
    return 'hyperpure-statement'
  }
  throw new StatementShapeError(
    `this file matches no known statement shape. Expected one of: ${KNOWN_SHAPES}.`,
  )
}

// --- Swiggy -----------------------------------------------------------------

/**
 * The one Swiggy payout annexure, as a settled cycle candidate.
 *
 * The file is generated for a PAID period: it carries every order's earnings
 * and taxes, a breakup whose Net Payout line must agree with the Summary's
 * Total Payout, and the bank UTR proving money moved. That is why this parser,
 * alone among the file paths, may claim `settled` - and why its operator cycle
 * reference is derived from the workbook's own digest: the same file uploaded
 * twice is inert at the ingest upsert, while a changed file is a new proposal
 * the caller must confirm.
 *
 * Only whitelisted columns are read. Customer name and phone columns exist in
 * this workbook; they are never copied into the payload, so no scrubbing pass
 * can be forgotten later.
 */
export function parseSwiggyAnnexure(
  decoded: DecodedStatement,
  outlets: OutletMap,
  digestHex: string,
): AggregatorCyclePayload {
  const summarySheet =
    Object.keys(decoded.sheets ?? {}).find((n) => n.trim().toLowerCase() === 'summary') ?? ''
  const orderSheetName = Object.keys(decoded.sheets ?? {}).find(
    (n) => n.trim().toLowerCase() === 'order level',
  )
  if (!summarySheet || !orderSheetName) {
    throw new StatementShapeError('the Swiggy annexure is missing Summary or Order Level')
  }

  const summary = decoded.sheets?.[summarySheet] ?? []
  let rid = ''
  let totalPayout: number | null = null
  for (const row of summary) {
    for (let c = 0; c < row.length; c += 1) {
      const value = String(row[c] ?? '').trim()
      const ridMatch = value.match(/^Rest\.?\s*ID\s*-\s*(\d+)$/i)
      if (ridMatch) rid = ridMatch[1] ?? ''
      if (/^Total Payout$/i.test(value)) {
        totalPayout = toPaise(String(row[c + 1] ?? ''), 'Total Payout')
      }
    }
  }
  if (!rid || !/^\d+$/.test(rid)) {
    throw new StatementShapeError('the Summary sheet does not name a numeric restaurant ID')
  }
  const outletId = outlets.swiggyRefs?.[rid]
  if (!outletId) {
    throw new StatementShapeError(`no outlet is mapped for Swiggy restaurant ${rid}`)
  }

  // The breakup's Net Payout total is the file's own arithmetic; the Summary's
  // Total Payout is the headline. They must agree or the file is not trusted.
  const breakupName = Object.keys(decoded.sheets ?? {}).find(
    (n) => n.trim().toLowerCase() === 'payout breakup',
  )
  if (breakupName && totalPayout !== null) {
    const breakupRows = decoded.sheets?.[breakupName] ?? []
    const netPayoutRow = breakupRows.find((row) =>
      row.some((value) => /^Net Payout/i.test(String(value).trim())),
    )
    // The row reads Delivered | Cancelled | Total; the grand total is its LAST
    // populated amount, wherever the workbook's leading columns place it.
    let breakupTotal: number | null = null
    if (netPayoutRow) {
      for (let c = netPayoutRow.length - 1; c >= 0; c -= 1) {
        const value = String(netPayoutRow[c] ?? '').trim()
        if (value === '') continue
        breakupTotal = toPaise(value, 'Net Payout')
        break
      }
    }
    if (breakupTotal !== null && Math.abs(breakupTotal - totalPayout) > 100) {
      throw new StatementShapeError(
        `the annexure disagrees with itself: Summary Total Payout ${totalPayout} vs Payout Breakup ${breakupTotal}`,
      )
    }
  }

  const orders = parseSwiggyOrderLevel(decoded.sheets?.[orderSheetName] ?? [])

  // No year appears in the file's Payout Period label, so the cycle window is
  // taken from the order rows themselves - min date to max date - which is also
  // what proves the file covers whole days rather than a fragment.
  if (orders.length === 0) throw new StatementShapeError('the Order Level sheet lists no orders')
  const dates = orders.map((o) => o.placed_at.slice(0, 10)).sort()
  const cycle_start = dates[0] ?? ''
  const cycle_end = dates[dates.length - 1] ?? ''

  return {
    contract_version: 1,
    outlet_id: outletId,
    channel: 'swiggy',
    restaurant_ref: rid,
    operator_cycle_ref: `file::${digestHex.slice(0, 16)}`,
    cycle_start,
    cycle_end,
    cycle_state: 'settled',
    stated_payout_paise: totalPayout,
    orders,
    deductions: [],
    cycle_deductions: [],
  }
}

/**
 * The annexure's Order Level sheet, read by column NAME.
 *
 * The header sits below two title/numbering rows, so it is located by finding
 * the row that names Order ID. Every wanted column must be present or the file
 * fails closed; anything not named here - including the customer-identifying
 * columns - never leaves the parser.
 */
function parseSwiggyOrderLevel(rows: Rows): AggregatorCyclePayload['orders'] {
  const headerRow = rows.findIndex((row) =>
    row.some((value) => String(value).trim().toLowerCase() === 'order id'),
  )
  if (headerRow < 0) throw new StatementShapeError('the Order Level sheet has no header row')
  const at = columnLocator(
    rows[headerRow] ?? [],
    [
      'Order ID',
      'Order Date',
      'Order Status',
      'Net Bill Value (before taxes) [1+2-3]',
      'Net Payout for Order (after taxes)\n[A-B-C-D]',
    ],
    'Order Level',
  )

  const orders: AggregatorCyclePayload['orders'] = []
  for (let r = headerRow + 1; r < rows.length; r += 1) {
    const row = rows[r]
    if (!row) continue
    const orderId = cell(row, at('Order ID')).trim()
    if (!orderId || !/^\d+$/.test(orderId)) continue

    const placedAt = parseWorkbookInstant(cell(row, at('Order Date')))
    const gross = toPaise(cell(row, at('Net Bill Value (before taxes) [1+2-3]')), 'Net Bill Value')
    const net = toPaise(
      cell(row, at('Net Payout for Order (after taxes)\n[A-B-C-D]')),
      'Net Payout for Order',
    )
    orders.push({
      order_id: orderId,
      placed_at: placedAt,
      gross_paise: gross,
      commission_paise: null,
      net_paise: net,
    })
  }
  return orders
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
    // Version 1 requires this field. It is deliberately compatibility-only:
    // ingest_supply_statement routes each order by source + invoice date.
    outlet_id: outlets.hyperpureCompatibilityOutletId,
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
//
// A Zomato payout workbook, read the way the sync settles a week (design D1-D6
// of `zomato-upload-settles-like-the-sync`). Measured on three real Kalyani
// workbooks on 2026-09-30:
//
//   * `Summary` and `Payout Breakup` are formulas whose cached values are
//     `#REF!` or 0, so neither is read for a figure.
//   * The hidden `HSummary` sheet states the report period, the one place the
//     workbook names its own week.
//   * `Order Level` states, per order, whether Zomato has paid it: `Settlement
//     status` (`settled`/`pending`), `Bank UTR` (or `NA`) and `Unsettled Amount`.
//     It also carries `Customer ID`, which nothing here reads.
//   * `Addition Deductions Details` lists what the payout took besides the orders:
//     growth services (ads, and TDS 194O), Hyperpure bills, other deductions,
//     adjustments, and additions, each with its own settlement status.
//
// Zomato's payout is the order-level payouts, less the sheet's `Total Deductions`,
// plus its `Total Additions`. The order-level payout already contains each
// order's cancellation refund.

/** Tolerance the ingest's gate uses, so the parser refuses exactly what it would. */
const RECONCILE_TOLERANCE_PAISE = 100

function findSheet(decoded: DecodedStatement, name: string): Rows | undefined {
  const want = name.trim().toLowerCase()
  const key = Object.keys(decoded.sheets ?? {}).find((n) => n.trim().toLowerCase() === want)
  return key === undefined ? undefined : decoded.sheets?.[key]
}

/** `Sep`, `Sept` or `September` to `09`; null for anything else. */
function monthNumber(name: string): string | null {
  const lower = name.trim().toLowerCase()
  if (lower.length < 3) return null
  const full = Object.keys(MONTHS).find((m) => m.startsWith(lower.slice(0, 3)))
  return full ? (MONTHS[full] ?? null) : null
}

/** `2026` or `26` as a four-digit year. */
function fullYear(text: string): string {
  return text.length === 2 ? `20${text}` : text
}

/**
 * `21 Sep 2026 - 27 Sep 2026`, or the deduction sheet's `25 September 26 -
 * 25 September 26`, as two ISO dates. Null when the text is not a period.
 */
export function parseZomatoPeriod(text: string): { start: string; end: string } | null {
  const match = String(text)
    .trim()
    .match(
      /^(\d{1,2})\s+([A-Za-z]{3,9})\s+'?(\d{2}|\d{4})\s*-\s*(\d{1,2})\s+([A-Za-z]{3,9})\s+'?(\d{2}|\d{4})$/,
    )
  if (!match) return null
  const [, d1 = '', m1 = '', y1 = '', d2 = '', m2 = '', y2 = ''] = match
  const month1 = monthNumber(m1)
  const month2 = monthNumber(m2)
  if (!month1 || !month2) return null
  const start = `${fullYear(y1)}-${month1}-${d1.padStart(2, '0')}`
  const end = `${fullYear(y2)}-${month2}-${d2.padStart(2, '0')}`
  return start <= end ? { start, end } : null
}

/** A cell that means something; `NA` and blank read as nothing. */
function present(value: string): string {
  const text = value.trim()
  return /^(na|n\/a|-)$/i.test(text) ? '' : text
}

interface ZomatoAdjustments {
  deductions: Array<{
    spent_on: string
    category: string
    amount_paise: number
    description: string
    source_ref: string
  }>
  cycleDeductions: Array<{
    kind: 'tax_deducted_at_source' | 'other_adjustment'
    period_start: string
    period_end: string
    amount_paise: number
    source_ref: string
  }>
  totalDeductions: number | null
  totalAdditions: number | null
  pending: string[]
}

interface AdjustmentColumns {
  type: number
  ref: number
  period: number
  status: number
  total: number
}

/**
 * The `Addition Deductions Details` sheet, itemised per design D6.
 *
 * The sheet is a stack of small tables, each under its own section title and
 * its own header row, so the columns are re-located at every header rather than
 * assumed. Subtotal rows (`Total …`) are skipped, except the two grand totals,
 * which are the workbook's own statement of what the payout took and gave.
 */
function parseZomatoAdjustments(
  rows: Rows,
  week: { start: string; end: string },
): ZomatoAdjustments {
  const result: ZomatoAdjustments = {
    deductions: [],
    cycleDeductions: [],
    totalDeductions: null,
    totalAdditions: null,
    pending: [],
  }
  let section: 'additions' | 'deductions' | null = null
  let group: 'growth' | 'hyperpure' | 'other' | 'previous' | null = null
  let col: AdjustmentColumns | null = null

  rows.forEach((row, index) => {
    const cells = row.map((c) => String(c ?? '').trim())
    const first = cells.find((c) => c !== '') ?? ''
    if (!first) return

    if (/^addition type$/i.test(first)) {
      section = 'additions'
      group = null
      return
    }
    if (/^deduction type$/i.test(first)) {
      section = 'deductions'
      group = null
      return
    }
    const groupMark = first.match(/^([A-D])\)/i)?.[1]?.toUpperCase()
    if (groupMark) {
      group = ({ A: 'growth', B: 'hyperpure', C: 'other', D: 'previous' } as const)[
        groupMark as 'A' | 'B' | 'C' | 'D'
      ]
      return
    }

    const totalAt = cells.findIndex((c) => /^total amount$/i.test(c))
    if (/^type$/i.test(first) && totalAt >= 0) {
      const at = (pattern: RegExp) => cells.findIndex((c) => pattern.test(c))
      col = {
        type: at(/^type$/i),
        ref: at(/invoice|order ?id|campaign/i),
        period: at(/period|date/i),
        status: at(/^settlement status$/i),
        total: totalAt,
      }
      return
    }

    const columns: AdjustmentColumns | null = col
    if (/^total additions/i.test(first) && columns) {
      result.totalAdditions = toPaise(cell(row, columns.total), 'Total Additions')
      return
    }
    if (/^total deductions/i.test(first) && columns) {
      result.totalDeductions = toPaise(cell(row, columns.total), 'Total Deductions')
      return
    }
    if (/^total/i.test(first)) return
    if (!columns || !section) return

    const type = cells[columns.type] ?? ''
    if (!type) return
    const amount = toPaise(cell(row, columns.total), `${type} amount`)
    const ref = present(cells[columns.ref] ?? '') || `row${index + 1}`
    const status = (cells[columns.status] ?? '').toLowerCase()
    if (status !== 'settled') result.pending.push(`${type} ${ref}`)
    const periodText = cells[columns.period] ?? ''
    const dated = parseZomatoPeriod(periodText)

    if (section === 'additions') {
      result.cycleDeductions.push({
        kind: 'other_adjustment',
        period_start: dated?.start ?? week.start,
        period_end: dated?.end ?? week.end,
        amount_paise: amount,
        source_ref: `zomato-workbook:addition:${type}:${ref}`,
      })
      return
    }
    if (group === 'previous') {
      // Zomato's own label puts these outside `Total Deductions (A)+(B)+(C)`,
      // and no measured workbook has carried one, so their sign in the payout is
      // unproved. Refused by name rather than guessed.
      throw new StatementShapeError(
        `this workbook carries an adjustment from a previous week (${type} ${ref}), which an upload cannot place yet; nothing was written`,
      )
    }
    if (group === 'other' || (group === 'growth' && /tds/i.test(type))) {
      const tax = group === 'growth'
      result.cycleDeductions.push({
        kind: tax ? 'tax_deducted_at_source' : 'other_adjustment',
        period_start: dated?.start ?? week.start,
        period_end: dated?.end ?? week.end,
        amount_paise: -amount,
        source_ref: `zomato-workbook:${tax ? 'tds' : 'other'}:${dated?.start ?? week.start}:${ref}`,
      })
      return
    }
    // Hyperpure bills and ads are spends, dated to when they happened. A
    // Hyperpure line is subtracted here for the reconciliation and then skipped
    // as an expense by the reserved-category trigger, because Hyperpure's own
    // reader already booked that purchase under its order number.
    if (!dated) {
      throw new StatementShapeError(
        `the deduction ${type} ${ref} carries a period this reader cannot parse: "${periodText}"`,
      )
    }
    const hyperpure = group === 'hyperpure'
    result.deductions.push({
      spent_on: dated.start,
      category: hyperpure ? 'Hyperpure' : type,
      amount_paise: amount,
      description: hyperpure ? `Zomato-collected Hyperpure order ${ref}` : `Zomato ${type} ${ref}`,
      source_ref: hyperpure ? `hyperpure:${ref}` : `zomato-workbook:${type}:${ref}`,
    })
  })

  return result
}

/** The week a workbook names for itself, found by its shape rather than its cell. */
function statedWeek(decoded: DecodedStatement): { start: string; end: string; text: string } {
  for (const row of findSheet(decoded, 'HSummary') ?? []) {
    for (const value of row) {
      const text = String(value ?? '').trim()
      const found = parseZomatoPeriod(text)
      if (found) return { ...found, text }
    }
  }
  throw new StatementShapeError(
    'this Zomato workbook does not state its payout period (its hidden HSummary sheet is missing or empty), so the week it covers cannot be named; download it again from the Zomato payouts page',
  )
}

const rupees = (paise: number) => `${paise < 0 ? '-' : ''}₹${(Math.abs(paise) / 100).toFixed(2)}`

/**
 * The Order Level sheet and its companions, as one settled cycle — or a refusal
 * that says why.
 *
 * Revenue is "Commissionable value" and net is "Order level Payout", so
 * commission is the difference, exactly as the sync reads the same sheet.
 * Columns are matched by name, so the other fifty-odd are ignored and a layout
 * change breaks loudly rather than reconciling against the wrong column.
 */
export function parseZomatoSettlement(
  decoded: DecodedStatement,
  outlets: OutletMap,
): AggregatorCyclePayload[] {
  const sheet = findSheet(decoded, 'Order Level')
  if (!sheet) throw new StatementShapeError('the settlement workbook has no Order Level sheet')

  // D2: the week the workbook names, never the span of its orders.
  const week = statedWeek(decoded)

  // Header is row 7 (index 6); tolerate a shifted title block by searching near it.
  let headerRow = 6
  const looksLikeHeader = (row: Rows[number] | undefined) =>
    !!row && row.some((c) => /^order id$/i.test(String(c).trim()))
  if (!looksLikeHeader(sheet[headerRow])) {
    headerRow = sheet.findIndex(looksLikeHeader)
    if (headerRow < 0) throw new StatementShapeError('the Order Level sheet has no Order ID header')
  }

  const names = sheet[headerRow] ?? []
  const find = (pattern: RegExp) =>
    names.findIndex((c) => pattern.test(String(c).replace(/\s+/g, ' ').trim()))
  const cols = {
    orderId: find(/^Order ID$/i),
    orderedAt: find(/^Order Date$/i),
    resId: find(/^Res\.? ID$/i),
    payout: find(/^Order level Payout/i),
    commissionable: find(/^Commissionable value/i),
    settlement: find(/^Settlement status$/i),
    utr: find(/^Bank UTR$/i),
    unsettled: find(/^Unsettled Amount$/i),
  }
  const missing = Object.entries(cols)
    .filter(([, i]) => i < 0)
    .map(([k]) => k)
  if (missing.length) {
    throw new StatementShapeError(`the Order Level sheet is missing columns: ${missing.join(', ')}`)
  }

  const orders: AggregatorCyclePayload['orders'] = []
  const resIds = new Set<string>()
  let pending = 0
  let withoutUtr = 0
  for (let r = headerRow + 1; r < sheet.length; r += 1) {
    const row = sheet[r]
    if (!row) continue
    const orderId = cell(row, cols.orderId).trim()
    if (!orderId || orderId.includes('#REF')) continue

    resIds.add(cell(row, cols.resId).trim())
    const placedAt = parseWorkbookInstant(cell(row, cols.orderedAt))
    const gross = toPaise(cell(row, cols.commissionable), 'Commissionable value')
    const net = toPaise(cell(row, cols.payout), 'Order level Payout')

    // D1: Zomato's own per-order statement of whether it has paid.
    const settled = cell(row, cols.settlement).trim().toLowerCase() === 'settled'
    const unsettled = toPaise(present(cell(row, cols.unsettled)), 'Unsettled Amount')
    if (!settled || unsettled !== 0) pending += 1
    else if (net !== 0 && !present(cell(row, cols.utr))) withoutUtr += 1

    const day = placedAt.slice(0, 10)
    if (day < week.start || day > week.end) {
      throw new StatementShapeError(
        `order ${orderId} is dated ${day}, outside the workbook's own period ${week.text}; nothing was written`,
      )
    }

    orders.push({
      order_id: orderId,
      placed_at: placedAt,
      gross_paise: gross,
      commission_paise: gross - net,
      net_paise: net,
    })
  }

  if (orders.length === 0) {
    throw new StatementShapeError(
      `the workbook for ${week.text} lists no orders; nothing was written`,
    )
  }
  if (pending > 0) {
    throw new StatementShapeError(
      `Zomato has not paid ${week.text} yet: ${pending} of ${orders.length} orders are still pending settlement. Upload this week's workbook after its payout date; nothing was written`,
    )
  }
  if (withoutUtr > 0) {
    throw new StatementShapeError(
      `${withoutUtr} of ${orders.length} orders in ${week.text} name no bank UTR, so this workbook does not show the payout was made; nothing was written`,
    )
  }

  // D3: one restaurant, named, and one this person may write for.
  if (resIds.size !== 1) {
    throw new StatementShapeError(
      `this workbook covers ${resIds.size} restaurants (${[...resIds].join(', ')}); download one outlet's payout at a time`,
    )
  }
  const [resId = ''] = [...resIds]
  const outletId = outlets.zomatoResIds[resId]
  if (!outletId) {
    throw new StatementShapeError(
      `Zomato restaurant ${resId} is not mapped to an outlet you can write for; nothing was written`,
    )
  }

  // D6: what else the payout took and gave.
  const adjustmentsSheet = findSheet(decoded, 'Addition Deductions Details')
  if (!adjustmentsSheet) {
    throw new StatementShapeError(
      'the workbook has no Addition Deductions Details sheet, so what Zomato deducted cannot be accounted for; nothing was written',
    )
  }
  const adjustments = parseZomatoAdjustments(adjustmentsSheet, week)
  if (adjustments.pending.length > 0) {
    throw new StatementShapeError(
      `Zomato has not settled ${adjustments.pending.length} deduction(s) for ${week.text} yet (${adjustments.pending.slice(0, 3).join(', ')}). Upload this week's workbook after its payout date; nothing was written`,
    )
  }
  if (adjustments.totalDeductions === null || adjustments.totalAdditions === null) {
    throw new StatementShapeError(
      'the Addition Deductions Details sheet has no Total Deductions or Total Additions line, so the payout cannot be checked; nothing was written',
    )
  }

  // D4: Zomato's totals against the lines itemised above, checked here so a
  // workbook that does not add up is refused before it can mark a day disputed.
  const ordersNet = orders.reduce((sum, o) => sum + o.net_paise, 0)
  const stated = ordersNet - adjustments.totalDeductions + adjustments.totalAdditions
  const computed =
    ordersNet -
    adjustments.deductions.reduce((sum, d) => sum + d.amount_paise, 0) +
    adjustments.cycleDeductions.reduce((sum, c) => sum + c.amount_paise, 0)
  if (Math.abs(computed - stated) > RECONCILE_TOLERANCE_PAISE) {
    throw new StatementShapeError(
      `the workbook for ${week.text} does not add up: its totals give a payout of ${rupees(stated)} but its itemised lines give ${rupees(computed)}, a difference of ${rupees(computed - stated)}; nothing was written`,
    )
  }

  return [
    {
      contract_version: 1,
      outlet_id: outletId,
      channel: 'zomato',
      restaurant_ref: resId,
      cycle_start: week.start,
      cycle_end: week.end,
      cycle_state: 'settled',
      stated_payout_paise: stated,
      orders,
      deductions: adjustments.deductions,
      cycle_deductions: adjustments.cycleDeductions,
    },
  ]
}

// --- entry -----------------------------------------------------------------

/**
 * A Business Metrics Report's calendar-day readings, as evidence only.
 *
 * The report totals its days on the portal's own calendar. An outlet whose
 * counter runs past midnight books those hours to the previous business day,
 * so a calendar total is never a ledger figure here; it names no business
 * window and none may be invented for it.
 */
export function parseSwiggyMetricsEvidence(decoded: DecodedStatement): SwiggyMetricsDay[] {
  const days: SwiggyMetricsDay[] = []
  for (const rows of Object.values(decoded.sheets ?? {})) {
    const headerRowIndex = rows.findIndex((row) => {
      const lower = row.map((value) => String(value).trim().toLowerCase())
      return lower.includes('overview') && lower.includes('metric')
    })
    if (headerRowIndex < 0) continue
    const header = rows[headerRowIndex] ?? []
    const dateColumns: { index: number; ymd: string }[] = []
    let restaurantRefColumn = -1
    for (let c = 0; c < header.length; c += 1) {
      const value = String(header[c] ?? '').trim()
      const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null
      if (parsedDate) dateColumns.push({ index: c, ymd: parsedDate })
      if (/restaurant/i.test(value)) restaurantRefColumn = c
    }
    if (dateColumns.length === 0 || restaurantRefColumn < 0) continue

    for (let r = headerRowIndex + 1; r < rows.length; r += 1) {
      const row = rows[r]
      if (!row) continue
      const overview = String(row.find((value) => /^sales$/i.test(String(value).trim())) ?? '')
      const metricCell = row.findIndex((value) => /^net\s*sales$/i.test(String(value).trim()))
      // Overview=SALES rows carry the Net Sales metric; anything else is not
      // the basis this app reconciles against, and mixing them would compare
      // different definitions of a day's takings.
      void overview
      if (metricCell < 0) continue
      const rid = cell(row, restaurantRefColumn).trim()
      if (!/^\d+$/.test(rid)) {
        throw new StatementShapeError('a metrics row does not name a numeric restaurant reference')
      }
      for (const column of dateColumns) {
        const paise = toPaise(cell(row, column.index), `Net Sales ${column.ymd}`)
        if (paise === 0 && cell(row, column.index).trim() === '') continue
        days.push({ restaurant_ref: rid, calendar_date: column.ymd, net_sales_paise: paise })
      }
    }
  }
  return days.sort(
    (a, b) =>
      a.restaurant_ref.localeCompare(b.restaurant_ref) ||
      a.calendar_date.localeCompare(b.calendar_date),
  )
}

/** Recognise a decoded statement and shape it for the ingest it belongs to. */
export function parseStatement(
  decoded: DecodedStatement,
  outlets: OutletMap,
  { digestHex = '' }: { digestHex?: string } = {},
): ParsedStatement {
  const kind = recognise(decoded)
  if (kind === 'hyperpure-statement') {
    return { kind, statement: parseHyperpure(decoded, outlets) }
  }
  if (kind === 'zomato-order-history') {
    return { kind, cycles: parseOrderHistory(decoded, outlets) }
  }
  if (kind === 'swiggy-metrics-evidence') {
    return { kind, days: parseSwiggyMetricsEvidence(decoded) }
  }
  if (kind === 'swiggy-annexure') {
    if (!digestHex) {
      throw new StatementShapeError('a Swiggy annexure needs its content digest to be named')
    }
    return { kind, cycles: [parseSwiggyAnnexure(decoded, outlets, digestHex)] }
  }
  return { kind: 'zomato-settlement', cycles: parseZomatoSettlement(decoded, outlets) }
}
