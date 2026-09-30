import { describe, expect, it } from 'vitest'
import { read, utils, write } from 'xlsx'
import { unzipSync, zipSync, strToU8 } from 'fflate'

import {
  parseStatement,
  recognise,
  toPaise,
  parseOrderHistoryInstant,
  parseZomatoPeriod,
  StatementShapeError,
  trueSheetRange,
  type DecodedStatement,
  type OutletMap,
} from '../../../supabase/functions/_shared/statement-parser-core'

/**
 * The parser core is proved against fixtures that mirror the real files column
 * for column, but are BUILT here rather than committed. The Zomato order-history
 * export carries customer identifiers and phone numbers, and committing one real
 * would be exactly the leak the PII rule exists to prevent — so the fixture
 * carries invented numbers instead, which is the stronger test: it proves those
 * columns never reach the output even when they are present and full.
 *
 * The two decoders — Node's `xlsx`/`fflate` here, the Edge Function's `npm:`
 * equivalents there — turn bytes into the same `DecodedStatement` this core takes,
 * so decoding through real bytes below exercises the whole path a file travels.
 */

const OUTLETS: OutletMap = {
  zomatoResIds: {
    '21917311': 'outlet-kalyani',
    '22675834': 'outlet-kanchrapara',
  },
  hyperpureCompatibilityOutletId: 'outlet-kanchrapara',
}

// --- decoders (the thin byte layer, Node side) -----------------------------

function decodeXlsx(bytes: Uint8Array): DecodedStatement {
  const wb = read(bytes, { type: 'array' })
  const sheets: Record<string, string[][]> = {}
  for (const name of wb.SheetNames) {
    // Zomato's workbooks declare ranges narrower than their cells; read what is there.
    const range = trueSheetRange(
      Object.keys(wb.Sheets[name]!).filter((key) => !key.startsWith('!')),
    )
    if (range) wb.Sheets[name]!['!ref'] = range
    sheets[name] = utils.sheet_to_json(wb.Sheets[name]!, {
      header: 1,
      raw: false,
      // Keep the time: a settlement order timestamp needs it for the trading-day
      // cutover. A date-only invoice cell renders as midnight and is sliced to ten.
      dateNF: 'yyyy-mm-dd hh:mm:ss',
      defval: '',
    }) as string[][]
  }
  return { sheets }
}

function decodeZip(bytes: Uint8Array): DecodedStatement {
  const files = unzipSync(bytes)
  const csv: Record<string, string[][]> = {}
  for (const [name, content] of Object.entries(files)) {
    const text = new TextDecoder().decode(content)
    csv[name] = parseCsv(text)
  }
  return { csv }
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

// --- fixtures --------------------------------------------------------------

function hyperpureBytes(
  firstInvoiceDate = '2026-08-02',
  secondInvoiceDate = '2026-08-04',
): Uint8Array {
  const soa: (string | number)[][] = [
    ['Summary of Shawarmania'],
    [],
    ['A', 'Total Billed Amount', 12000],
    // ...summary rows the parser must skip...
    [],
    // header row (row index 5 here, wherever it lands)
    [
      'Outlet ID',
      'Outlet Name',
      'Order number',
      'Order status',
      'Order Date',
      'Invoice No',
      'Invoice type',
      'Invoice Date',
      'Taxable Value',
      'Invoice Amt',
      'Credit Note Nos',
      'Credit Note Amt',
      'Paid Amt',
    ],
    // Order 1: two invoices (taxable + non-taxable), one small credit note.
    [
      '1719650',
      'Shawarmania',
      'ZHPWB27-OR-1',
      'DELIVERED',
      '2026-08-01',
      'ZBS-1',
      'NON-TAXABLE_GOODS',
      firstInvoiceDate,
      1200,
      1200,
      '',
      0,
      1200,
    ],
    [
      '1719650',
      'Shawarmania',
      'ZHPWB27-OR-1',
      'DELIVERED',
      '2026-08-01',
      'ZHP-1',
      'TAXABLE_GOODS_AND_SERVICES',
      firstInvoiceDate,
      7633,
      8111.11,
      'CN-1',
      111.11,
      8000,
    ],
    // Order 2: a single invoice.
    [
      '1719650',
      'Shawarmania',
      'ZHPWB27-OR-2',
      'DELIVERED',
      '2026-08-03',
      'ZBS-2',
      'NON-TAXABLE_GOODS',
      secondInvoiceDate,
      1785,
      1785,
      '',
      0,
      1785,
    ],
  ]
  const ledger = [['Outlet Id', 'Order Number', 'Res ID', 'Amount Paid', 'Payment Method']]
  const wb = utils.book_new()
  utils.book_append_sheet(wb, utils.aoa_to_sheet(soa), 'Overall SOA')
  utils.book_append_sheet(wb, utils.aoa_to_sheet(ledger), 'Payment Ledger')
  return new Uint8Array(write(wb, { type: 'array', bookType: 'xlsx' }))
}

// --- Zomato payout workbook -------------------------------------------------
//
// Built to the layout measured on three real Kalyani workbooks on 2026-09-30
// (design Context of `zomato-upload-settles-like-the-sync`): a hidden `HSummary`
// whose row 2 states the week, an `Order Level` sheet with its header on row 7,
// a `#REF!` template row, the settlement columns and a full `Customer ID`
// column, and an `Addition Deductions Details` sheet stacked in sections. The
// numbers are invented; the customer column is present and full so the scrub
// assertion means something.

const SETTLEMENT_CUSTOMER = 'ZCUST-SECRET-77'

interface WorkbookOrder {
  id: string
  at: string
  res?: string
  commissionable: string
  payout: string
  status?: string
}

interface WorkbookOptions {
  paid?: boolean
  period?: string | null
  orders?: WorkbookOrder[]
  hyperpure?: { amount: string; status?: string } | null
  tds?: string | null
  previousWeek?: boolean
  /** Overrides the sheet's own Total Deductions line. */
  totalDeductions?: string
  dropColumns?: string[]
}

const WEEK_ORDERS: WorkbookOrder[] = [
  // Tuesday first: the week still starts on the Monday the workbook names.
  { id: 'Z-101', at: '2026-09-22 13:05:00', commissionable: '500', payout: '360.1234' },
  { id: 'Z-102', at: '2026-09-26 21:14:02', commissionable: '268', payout: '166.7502' },
  { id: 'Z-103', at: '2026-09-27 23:40:00', commissionable: '800', payout: '534.5' },
]

function zomatoWorkbookBytes(options: WorkbookOptions = {}): Uint8Array {
  const paid = options.paid ?? true
  const orders = options.orders ?? WEEK_ORDERS
  const period = options.period === undefined ? '21 Sep 2026 - 27 Sep 2026' : options.period
  const hyperpure = options.hyperpure === undefined ? { amount: '961.5' } : options.hyperpure
  const settledWord = paid ? 'settled' : 'pending'

  const header = [
    'S.No.',
    'Order ID',
    'Order Date',
    'Week No.',
    'Res. name',
    'Res. ID',
    'Order status (Delivered/ Cancelled/ Rejected)',
    'Commissionable value (excludes customer GST)\n[(A) + (7) - (8) - (6) - (3)]',
    'Order level Payout (A) - (E) + (F)',
    'Settlement status',
    'Settlement date',
    'Bank UTR',
    'Unsettled Amount',
    'Customer ID',
  ].filter((name) => !(options.dropColumns ?? []).includes(name))
  const keep = (name: string) => !(options.dropColumns ?? []).includes(name)

  const orderRows = orders.map((o, i) => {
    const values: Record<string, string> = {
      'S.No.': String(i + 1),
      'Order ID': o.id,
      'Order Date': o.at,
      'Week No.': '39',
      'Res. name': 'Shawarmania',
      'Res. ID': o.res ?? '21917311',
      'Order status (Delivered/ Cancelled/ Rejected)': 'DELIVERED',
      'Commissionable value (excludes customer GST)\n[(A) + (7) - (8) - (6) - (3)]':
        o.commissionable,
      'Order level Payout (A) - (E) + (F)': o.payout,
      'Settlement status': o.status ?? settledWord,
      'Settlement date': paid ? '2026-09-30 05:30:00' : 'NA',
      'Bank UTR': paid ? 'CITIN26000000001' : 'NA',
      'Unsettled Amount': paid ? '0.0' : o.payout,
      'Customer ID': SETTLEMENT_CUSTOMER,
    }
    return Object.keys(values)
      .filter(keep)
      .map((k) => values[k] ?? '')
  })

  const orderLevel = [
    ['Order level Breakup'],
    ['Detailed view of your order level earnings, deductions, pay-outs'],
    ['Get definition of terms used in this sheet- Glossary'],
    [],
    ['RESTAURANT DETAILS >'],
    ['', '', '', '', '', '', '', '(A)', '(G)', '(33)', '(34)', '(35)', '(36)'],
    header,
    ['1', '#REF!'],
    ...orderRows,
  ]

  const hsummary = [
    [],
    ['', '', '', '', period ?? '', '21917311', 'MID-1', 'Legal', 'Shawarmania', 'Address', 'PAN'],
  ]

  const deductionHeader = (ref: string) => [
    '',
    'Type',
    'Res id for which deduction created',
    ref,
    'Deduction time period',
    'Settlement Status',
    'Total amount',
    'Adjusted amount',
    'Outstanding amount',
  ]
  const growth: string[][] = []
  let growthTotal = 0
  if (options.tds) {
    growth.push([
      '',
      'TDS 194O',
      'NA',
      'NA',
      '31 July 26 - 31 July 26',
      'settled',
      options.tds,
      options.tds,
      '0.0',
    ])
    growthTotal += Number(options.tds)
  }
  const hyperpureRows: string[][] = []
  let hyperpureTotal = 0
  if (hyperpure) {
    const status = hyperpure.status ?? settledWord
    hyperpureRows.push([
      '',
      'Hyperpure',
      '22675834', // the OTHER outlet, as the real Kalyani workbook reads
      '30540356',
      '25 September 26 - 25 September 26',
      status,
      hyperpure.amount,
      status === 'settled' ? hyperpure.amount : '0.0',
      status === 'settled' ? '0.0' : hyperpure.amount,
    ])
    hyperpureTotal += Number(hyperpure.amount)
  }
  const previous: string[][] = options.previousWeek
    ? [
        deductionHeader('Invoice No'),
        ['', 'Adjustment', 'NA', 'ADJ-1', '14 September 26 - 14 September 26', 'settled', '50'],
      ]
    : []
  const total = options.totalDeductions ?? String(growthTotal + hyperpureTotal)

  const adjustments = [
    ['', 'Addition/ Deduction Details (non-order level additions/deductions)'],
    ['', 'Summarized view on : 1. Res id level additions like 194 H'],
    [],
    [],
    ['', 'Addition Type'],
    [
      '',
      'Type',
      'NA',
      'Invoice No/Order id',
      'Order date',
      'Settlement status',
      'Total amount',
      'Adjusted amount',
      'Outstanding amount',
    ],
    ['', 'Total Additions', '', '', '', '', '0.0', '0.0', '0.0'],
    [],
    [],
    ['', 'Deduction Type'],
    ['', 'A) Investments in growth services'],
    deductionHeader('Invoice No/Campaign id'),
    ...growth,
    ['', 'Total Ads & miscellaneous services', '', '', '', '', String(growthTotal)],
    [],
    ['', 'B) Investments in Hyperpure'],
    deductionHeader('OrderId'),
    ...hyperpureRows,
    ['', 'Total Hyperpure', '', '', '', '', String(hyperpureTotal)],
    [],
    ['', 'C) Other deductions'],
    ['', 'D) Adjustments from previous weeks'],
    ...previous,
    ['', 'Total Deductions (A)+(B)+(C)', '', '', '', '', total, total, '0.0'],
  ]

  const wb = utils.book_new()
  utils.book_append_sheet(
    wb,
    utils.aoa_to_sheet([['Report Summary'], ['Report Period', '#REF!']]),
    'Summary',
  )
  utils.book_append_sheet(wb, utils.aoa_to_sheet([['Payout Breakup']]), 'Payout Breakup')
  utils.book_append_sheet(wb, utils.aoa_to_sheet(orderLevel), 'Order Level')
  utils.book_append_sheet(wb, utils.aoa_to_sheet(adjustments), 'Addition Deductions Details')
  if (options.period !== null) {
    utils.book_append_sheet(wb, utils.aoa_to_sheet(hsummary), 'HSummary')
  }
  return withZomatoDimensions(new Uint8Array(write(wb, { type: 'array', bookType: 'xlsx' })))
}

/**
 * Zomato's workbooks declare sheet ranges that are narrower than their cells.
 *
 * Measured on the real 14-20 Sep 2026 workbook: `Order Level` declares
 * `A9:BG57` although its header is row 7, `Addition Deductions Details` declares
 * `B5:I21` from row 1, and `HSummary` declares `E2:S2`. A reader that trusts the
 * tag loses the header, which is how the first production upload was refused
 * with "no Order ID header". The fixture rewrites the same tags into the bytes
 * so that failure is reproduced here rather than first seen by the owner.
 */
function withZomatoDimensions(bytes: Uint8Array): Uint8Array {
  const files = unzipSync(bytes)
  const workbook = new TextDecoder().decode(files['xl/workbook.xml'])
  const rels = new TextDecoder().decode(files['xl/_rels/workbook.xml.rels'])
  const declared: Record<string, string> = {
    'Order Level': 'A9:N12',
    'Addition Deductions Details': 'B5:I21',
    HSummary: 'E2:K2',
  }
  for (const [sheet, ref] of Object.entries(declared)) {
    const rid = workbook.match(new RegExp(`<sheet[^>]*name="${sheet}"[^>]*r:id="(rId[0-9]+)"`))?.[1]
    const target = rels.match(new RegExp(`Id="${rid}"[^>]*Target="([^"]+)"`))?.[1]
    if (!rid) continue // the case that leaves the sheet out on purpose
    if (!target) throw new Error(`fixture: no sheet file for ${sheet}`)
    const path = `xl/${target.replace(/^\/?xl\//, '')}`
    const xml = new TextDecoder().decode(files[path])
    const narrowed = xml.replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="${ref}"/>`)
    if (narrowed === xml) throw new Error(`fixture: ${sheet} declares no dimension to narrow`)
    files[path] = strToU8(narrowed)
  }
  return zipSync(files)
}

function settlementBytes(): Uint8Array {
  return zomatoWorkbookBytes()
}

const FAKE_PHONE = '9998887776'
const FAKE_CUSTOMER = 'CUST-SECRET-42'

function orderHistoryBytes(): Uint8Array {
  const header = [
    'Restaurant ID',
    'Restaurant name',
    'Subzone',
    'City',
    'Order ID',
    'Order Placed At',
    'Order Status',
    'Delivery',
    'Distance',
    'Items in order',
    'Instructions',
    'Discount construct',
    'Bill subtotal',
    'Packaging charges',
    'Restaurant discount (Promo)',
    'Restaurant discount (Flat offs',
    ' Freebies & others)',
    'Gold discount',
    'Brand pack discount',
    'Total',
    'Rating',
    'Review',
    'Cancellation / Rejection reason',
    'Restaurant compensation (Cancellation)',
    'Restaurant penalty (Rejection)',
    'KPT duration (minutes)',
    'Rider wait time (minutes)',
    'Order Ready Marked',
    'Customer complaint tag',
    'Customer ID',
    'Customer Phone',
  ]
  const rowKal = [
    '21917311',
    'Shawarmania',
    'Kalyani',
    'Kolkata',
    'ORD-1',
    '08:17 PM, August 17 2026',
    'Delivered',
    '',
    '',
    '1 x Shawarma',
    '',
    '',
    '314',
    '9.5',
    '0',
    '0',
    '0',
    '0',
    '0',
    '260.7',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    FAKE_CUSTOMER,
    FAKE_PHONE,
  ]
  const rowKan = [
    '22675834',
    'Shawarmania',
    'Kanchrapara',
    'Kolkata',
    'ORD-2',
    '01:35 PM, August 17 2026',
    'Delivered',
    '',
    '',
    '2 x Roll',
    '',
    '',
    '787',
    '27',
    '0',
    '0',
    '0',
    '0',
    '0',
    '814',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    'CUST-9',
    '8887776665',
  ]
  const csv = [header, rowKal, rowKan].map((r) => r.map((c) => `"${c}"`).join(',')).join('\n')
  const zipped = zipSync({ 'order_history_20260817_20260818.csv': strToU8(csv) })
  return new Uint8Array(zipped)
}

// --- tests -----------------------------------------------------------------

describe('the statement parser core', () => {
  describe('money and dates', () => {
    it('converts a computed float to exact paise', () => {
      // The value SheetJS really produces from a split cell.
      expect(toPaise(3774.577392578125, 'x')).toBe(377458)
      expect(toPaise('₹1,200.00', 'x')).toBe(120000)
      expect(toPaise('', 'x')).toBe(0)
    })

    it('refuses a value that is not a number rather than reading it as nought', () => {
      expect(() => toPaise('n/a', 'Invoice Amt')).toThrow(StatementShapeError)
    })

    it('reads the third Zomato date format to an IST instant', () => {
      expect(parseOrderHistoryInstant('08:17 PM, August 17 2026')).toBe('2026-08-17T20:17:00+05:30')
      expect(parseOrderHistoryInstant('12:06 AM, August 18 2026')).toBe('2026-08-18T00:06:00+05:30')
    })
  })

  describe('recognition, by content and never by filename', () => {
    it('knows a Hyperpure statement by its sheets', () => {
      expect(recognise(decodeXlsx(hyperpureBytes()))).toBe('hyperpure-statement')
    })

    it('knows a Zomato order history by the csv inside the archive', () => {
      expect(recognise(decodeZip(orderHistoryBytes()))).toBe('zomato-order-history')
    })

    it('knows a Zomato payout workbook although it shares three sheets with a Swiggy annexure', () => {
      expect(recognise(decodeXlsx(settlementBytes()))).toBe('zomato-settlement')
    })

    it('refuses an unknown shape and names the shapes it did not match', () => {
      expect(() => recognise({ sheets: { Random: [['a']] } })).toThrow(/no known statement shape/)
    })
  })

  describe('Hyperpure: one order, one row', () => {
    it('sums an order’s invoices, subtracts its credit note, dates by invoice', () => {
      const parsed = parseStatement(decodeXlsx(hyperpureBytes()), OUTLETS)
      if (parsed.kind !== 'hyperpure-statement') throw new Error('wrong kind')

      const first = parsed.statement.orders.find((o) => o.order_ref === 'ZHPWB27-OR-1')
      expect(first).toBeDefined()
      // 1200 + 8111.11 − 111.11 = 9200.00
      expect(first?.amount_paise).toBe(920000)
      expect(first?.invoice_date).toBe('2026-08-02')
      expect(first?.shared_cost).toBe(true)

      const second = parsed.statement.orders.find((o) => o.order_ref === 'ZHPWB27-OR-2')
      // A single-invoice order is not treated as half-recorded.
      expect(second?.amount_paise).toBe(178500)

      expect(parsed.statement.outlet_id).toBe('outlet-kanchrapara')
      expect(parsed.statement.orders).toHaveLength(2)
    })

    it('gives scheduled and manually uploaded cross-boundary bytes the same candidate', () => {
      const bytes = hyperpureBytes('2026-09-15', '2026-09-16')
      const scheduled = parseStatement(decodeXlsx(bytes), OUTLETS)
      const manual = parseStatement(decodeXlsx(bytes), OUTLETS)

      expect(manual).toEqual(scheduled)
      if (scheduled.kind !== 'hyperpure-statement') throw new Error('wrong kind')
      expect(scheduled.statement.outlet_id).toBe('outlet-kanchrapara')
      expect(scheduled.statement.orders.map((order) => order.invoice_date)).toEqual([
        '2026-09-15',
        '2026-09-16',
      ])
    })
  })

  describe('Zomato order history: a provisional cycle per outlet, no PII', () => {
    it('groups by outlet, leaves commission undetermined, drops customer detail', () => {
      const parsed = parseStatement(decodeZip(orderHistoryBytes()), OUTLETS)
      if (parsed.kind !== 'zomato-order-history') throw new Error('wrong kind')

      expect(parsed.cycles).toHaveLength(2)
      const kal = parsed.cycles.find((c) => c.outlet_id === 'outlet-kalyani')
      expect(kal?.cycle_state).toBe('provisional')
      expect(kal?.orders[0]!.commission_paise).toBeNull()
      // 314 + 9.5 = 323.50 commissionable
      expect(kal?.orders[0]!.gross_paise).toBe(32350)
      expect(kal?.orders[0]!.placed_at).toBe('2026-08-17T20:17:00+05:30')

      // The whole point: no invented customer number survives anywhere.
      const serialised = JSON.stringify(parsed)
      expect(serialised).not.toContain(FAKE_PHONE)
      expect(serialised).not.toContain(FAKE_CUSTOMER)
    })
  })

  describe('Zomato settlement: a paid week settles the way the sync settles it', () => {
    const settle = (options: WorkbookOptions = {}) => {
      const parsed = parseStatement(decodeXlsx(zomatoWorkbookBytes(options)), OUTLETS)
      if (parsed.kind !== 'zomato-settlement') throw new Error('wrong kind')
      return parsed.cycles
    }
    const refusal = (options: WorkbookOptions) => {
      try {
        settle(options)
      } catch (cause) {
        expect(cause).toBeInstanceOf(StatementShapeError)
        return (cause as Error).message
      }
      throw new Error('the workbook was accepted')
    }

    it('settles one cycle for the week the workbook names, not the span of its orders', () => {
      const [cycle, ...rest] = settle()
      expect(rest).toHaveLength(0)
      expect(cycle?.cycle_state).toBe('settled')
      expect(cycle?.outlet_id).toBe('outlet-kalyani')
      expect(cycle?.restaurant_ref).toBe('21917311')
      // The first order is a Tuesday; the week is still the Monday-to-Sunday one
      // the workbook states, so the ingest names it exactly as the sync does.
      expect(cycle?.cycle_start).toBe('2026-09-21')
      expect(cycle?.cycle_end).toBe('2026-09-27')
      expect(cycle?.operator_cycle_ref).toBeUndefined()
    })

    it('takes commissionable as revenue and order-level payout as net', () => {
      const [cycle] = settle()
      const order = cycle?.orders.find((o) => o.order_id === 'Z-102')
      expect(order?.gross_paise).toBe(26800)
      expect(order?.net_paise).toBe(16675) // 166.7502 rounds to 16675 paise
      expect(order?.commission_paise).toBe(26800 - 16675)
      expect(order?.placed_at).toBe('2026-09-26T21:14:02+05:30')
      // The template #REF! row is not an order.
      expect(cycle?.orders).toHaveLength(3)
    })

    it('reconciles the Hyperpure bill the payout collected without booking it as a second expense', () => {
      const [cycle] = settle()
      // 360.1234 + 166.7502 + 534.5, each rounded once, less the ₹961.50 bill.
      expect(cycle?.stated_payout_paise).toBe(36012 + 16675 + 53450 - 96150)
      expect(cycle?.deductions).toEqual([
        {
          spent_on: '2026-09-25',
          category: 'Hyperpure', // reserved: the ingest subtracts it, the trigger skips the row
          amount_paise: 96150,
          description: 'Zomato-collected Hyperpure order 30540356',
          source_ref: 'hyperpure:30540356',
        },
      ])
      expect(cycle?.cycle_deductions).toEqual([])
    })

    it('carries a TDS line as a cycle-level tax, by Zomato’s own formula', () => {
      const [cycle] = settle({ tds: '311.24' })
      expect(cycle?.cycle_deductions).toEqual([
        {
          kind: 'tax_deducted_at_source',
          period_start: '2026-07-31',
          period_end: '2026-07-31',
          amount_paise: -31124,
          source_ref: 'zomato-workbook:tds:2026-07-31:row13',
        },
      ])
      expect(cycle?.stated_payout_paise).toBe(36012 + 16675 + 53450 - 96150 - 31124)
    })

    it('never reads the customer column into the payload', () => {
      const serialised = JSON.stringify(settle())
      expect(serialised).not.toContain(SETTLEMENT_CUSTOMER)
    })

    it('refuses a week Zomato has not paid, saying how many orders are pending', () => {
      expect(refusal({ paid: false })).toBe(
        "Zomato has not paid 21 Sep 2026 - 27 Sep 2026 yet: 3 of 3 orders are still pending settlement. Upload this week's workbook after its payout date; nothing was written",
      )
    })

    it('refuses a week in which even one order is still pending', () => {
      const orders = WEEK_ORDERS.map((o, i) => (i === 1 ? { ...o, status: 'pending' } : o))
      expect(refusal({ orders })).toMatch(/1 of 3 orders are still pending settlement/)
    })

    it('refuses a deduction Zomato has not settled yet', () => {
      expect(refusal({ hyperpure: { amount: '961.5', status: 'pending' } })).toMatch(
        /has not settled 1 deduction\(s\) for 21 Sep 2026 - 27 Sep 2026 yet \(Hyperpure 30540356\)/,
      )
    })

    it('refuses a workbook that does not state its week', () => {
      expect(refusal({ period: null })).toMatch(/does not state its payout period/)
    })

    it('refuses an order dated outside the stated week', () => {
      const orders = [
        ...WEEK_ORDERS,
        { id: 'Z-9', at: '2026-09-28 12:00:00', commissionable: '1', payout: '1' },
      ]
      expect(refusal({ orders })).toMatch(
        /order Z-9 is dated 2026-09-28, outside the workbook's own period/,
      )
    })

    it('names a restaurant nobody may write for, instead of succeeding with nothing written', () => {
      const orders = WEEK_ORDERS.map((o) => ({ ...o, res: '99999999' }))
      expect(refusal({ orders })).toBe(
        'Zomato restaurant 99999999 is not mapped to an outlet you can write for; nothing was written',
      )
    })

    it('refuses a workbook covering two restaurants', () => {
      const orders = WEEK_ORDERS.map((o, i) => (i === 0 ? { ...o, res: '22675834' } : o))
      expect(refusal({ orders })).toMatch(/covers 2 restaurants/)
    })

    it('refuses when the itemised lines do not add up to the workbook’s own totals', () => {
      expect(refusal({ totalDeductions: '1161.5' })).toBe(
        'the workbook for 21 Sep 2026 - 27 Sep 2026 does not add up: its totals give a payout of -₹100.13 but its itemised lines give ₹99.87, a difference of ₹200.00; nothing was written',
      )
    })

    it('refuses an adjustment from a previous week rather than guessing its sign', () => {
      expect(refusal({ previousWeek: true })).toMatch(
        /adjustment from a previous week \(Adjustment ADJ-1\)/,
      )
    })

    it('names the settlement columns an incomplete workbook is missing', () => {
      expect(refusal({ dropColumns: ['Settlement status', 'Unsettled Amount'] })).toBe(
        'the Order Level sheet is missing columns: settlement, unsettled',
      )
    })

    it('reads both of the workbook’s period spellings', () => {
      expect(parseZomatoPeriod('21 Sep 2026 - 27 Sep 2026')).toEqual({
        start: '2026-09-21',
        end: '2026-09-27',
      })
      expect(parseZomatoPeriod('28 December 26 - 03 January 27')).toEqual({
        start: '2026-12-28',
        end: '2027-01-03',
      })
      expect(parseZomatoPeriod('#REF!')).toBeNull()
    })
  })
})

// --- Swiggy annexure --------------------------------------------------------
//
// Built to the real workbook's layout column for column - title row, numbering
// row, header row, then data - with invented orders and an invented RID. The
// customer-identifying columns of the real file are present and full, which is
// what makes the scrub assertion mean something.

const ANNEXURE_HEADER = [
  'Order ID',
  'Parent Order ID',
  'Order Date',
  'Order Status',
  'Order Category',
  'Order Payment Type',
  'Cancelled By?',
  'Coupon type applied by customer',
  'Item Total',
  'Packaging Charges',
  'Restaurant Discounts (Promo, Freebies, Flat Off, etc.)',
  'Swiggy One \nExclusive Offer Discount',
  'Restaurant Discount Share [3a+3b]',
  'Net Bill Value (before taxes) [1+2-3]',
  'GST Collected',
  'Total Customer Paid [4+5]',
  'Commission charged on',
  'Service Fees %',
  'Commission',
  'Long Distance Charges',
  'Discount on Long Distance Fee',
  'Pocket Hero Fees',
  'No Fees Week - Cashback',
  'Swiggy One Fees',
  'Payment Collection Charges',
  'Restaurant Cancellation Charges',
  'Call Center Charges',
  'Delivery Fee sponsored by Restaurant (w/o tax)',
  'Bolt Fees',
  'GST on Service Fee @18%',
  'Total Swiggy Fees\n[6+7+8-9+10+11+12+13+14+15+16+17]',
  'Customer Cancellations',
  'Customer Complaints',
  'Complaint & Cancellation Charges\n[18+19]',
  'GST Deduction',
  'TCS',
  'TDS',
  'Total Taxes\n[20+21+22]',
  'Net Payout for Order (after taxes)\n[A-B-C-D]',
  'Long Distance Order',
]

function annexureRow(overrides: Record<number, string>): string[] {
  const row = new Array<string>(ANNEXURE_HEADER.length).fill('')
  row[3] = 'delivered'
  row[4] = 'Swiggy'
  row[5] = 'prepaid'
  return Object.assign(row, overrides)
}

const SWIGGY_OUTLETS: OutletMap = {
  zomatoResIds: {},
  hyperpureCompatibilityOutletId: '',
  swiggyRefs: { '9999999': 'outlet-kalyani' },
}

function annexureSheets(): Record<string, string[][]> {
  const orderRows = [
    ['Order Level Breakup\nDetailed view'],
    [],
    ANNEXURE_HEADER,
    annexureRow({
      0: '111111111111111',
      2: '2026-08-09 14:04:00',
      3: 'cancelled',
      6: 'MERCHANT',
      8: '0',
      13: '0',
      38: '-2.23',
      // A customer column, present and full, that must never leave the parser.
      43: 'PHONE 98300 00000 NAME Test Customer',
    }),
    annexureRow({
      0: '222222222222222',
      2: '2026-08-09 17:57:30',
      8: '298',
      13: '298',
      38: '104.65',
    }),
    annexureRow({
      0: '333333333333333',
      2: '2026-08-12 21:05:00',
      8: '149',
      13: '119',
      38: '35.39',
    }),
  ]
  return {
    Summary: [
      [],
      [],
      [],
      [],
      ['', 'Shawarmania'],
      ['', 'Rest. ID - 9999999'],
      ['', 'Payout Period', '09 August - 15 August'],
      ['', 'Total Payout', '\u20B9137.81'],
      ['', 'Bank UTR', 'AXISCN0000000000'],
    ],
    'Payout Breakup': [
      [],
      [],
      [],
      ['', '', 'Particulars', 'Delivered Orders', 'Cancelled Orders', 'Total'],
      ['G', 'Net Payout [A+B+C+D+E+F]', '', '-2.23', '140.04', '137.81'],
    ],
    'Order Level': orderRows,
  }
}

describe('the Swiggy payout annexure', () => {
  it('is recognised ahead of the Zomato settlement despite sharing an Order Level sheet', () => {
    expect(recognise({ sheets: annexureSheets() })).toBe('swiggy-annexure')
  })

  it('parses into one settled candidate whose orders reconcile the stated payout', () => {
    const parsed = parseStatement({ sheets: annexureSheets() }, SWIGGY_OUTLETS, {
      digestHex: 'a'.repeat(64),
    })
    expect(parsed.kind).toBe('swiggy-annexure')
    if (parsed.kind !== 'swiggy-annexure') return
    const cycle = parsed.cycles[0]!
    expect(cycle.stated_payout_paise).not.toBeNull()
    expect(cycle.channel).toBe('swiggy')
    expect(cycle.restaurant_ref).toBe('9999999')
    expect(cycle.outlet_id).toBe('outlet-kalyani')
    expect(cycle.operator_cycle_ref).toBe(`file::${'a'.repeat(16)}`)
    expect(cycle.cycle_state).toBe('settled')
    expect(cycle.cycle_start).toBe('2026-08-09')
    expect(cycle.cycle_end).toBe('2026-08-12')
    expect(cycle.stated_payout_paise).toBe(13781)
    const netSum = cycle.orders.reduce((total, o) => total + o.net_paise, 0)
    // The file's own arithmetic: order payouts sum to its Net Payout line.
    expect(Math.abs(netSum - (cycle.stated_payout_paise ?? 0))).toBeLessThanOrEqual(1)
  })

  it('never copies a customer-identifying column into the payload', () => {
    const parsed = parseStatement({ sheets: annexureSheets() }, SWIGGY_OUTLETS, {
      digestHex: 'b'.repeat(64),
    })
    if (parsed.kind !== 'swiggy-annexure') throw new Error('wrong kind')
    const text = JSON.stringify(parsed)
    expect(text.includes('Test Customer')).toBe(false)
    expect(text.includes('98300')).toBe(false)
  })

  it('fails closed when a wanted column is missing', () => {
    const sheets = annexureSheets()
    const rows = sheets['Order Level'] ?? []
    const header = [...(rows[2] ?? [])]
    header[38] = ''
    rows[2] = header
    expect(() => parseStatement({ sheets }, SWIGGY_OUTLETS, { digestHex: 'c'.repeat(64) })).toThrow(
      StatementShapeError,
    )
  })

  it('refuses an unmapped restaurant reference', () => {
    const sheets = annexureSheets()
    ;(sheets.Summary ?? [])[5] = ['', 'Rest. ID - 8888888']
    expect(() => parseStatement({ sheets }, SWIGGY_OUTLETS, { digestHex: 'd'.repeat(64) })).toThrow(
      StatementShapeError,
    )
  })
})

describe('a sheet read by what it holds, not by what it declares', () => {
  it('spans every cell it has', () => {
    expect(trueSheetRange(['A1', 'BG57', 'C7'])).toBe('A1:BG57')
    expect(trueSheetRange(['E2', 'S2'])).toBe('E2:S2')
    expect(trueSheetRange(['Z3', 'AA10', 'B4'])).toBe('B3:AA10')
    expect(trueSheetRange([])).toBeNull()
  })
})
