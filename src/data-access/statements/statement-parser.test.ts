import { describe, expect, it } from 'vitest'
import { read, utils, write } from 'xlsx'
import { unzipSync, zipSync, strToU8 } from 'fflate'

import {
  parseStatement,
  recognise,
  toPaise,
  parseOrderHistoryInstant,
  StatementShapeError,
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
  hyperpureOutletId: 'outlet-kanchrapara',
}

// --- decoders (the thin byte layer, Node side) -----------------------------

function decodeXlsx(bytes: Uint8Array): DecodedStatement {
  const wb = read(bytes, { type: 'array' })
  const sheets: Record<string, string[][]> = {}
  for (const name of wb.SheetNames) {
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

function hyperpureBytes(): Uint8Array {
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
      '2026-08-02',
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
      '2026-08-02',
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
      '2026-08-04',
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

function settlementBytes(): Uint8Array {
  // Only the columns the parser reads, at the real positions: header row 7
  // (index 6), data from row 8. The other fifty-odd columns are matched by name
  // so their absence changes nothing.
  const blank = Array(4).fill('')
  const header = [
    'Sr',
    'Order ID',
    'Order Date',
    'Restaurant name',
    'Res. ID',
    'Commissionable value (excludes customer GST)',
    'Order level Payout (A) - (E) + (F)',
    'Settlement status',
  ]
  const ref = ['1', '#REF!', '', '', '', '', '', ''] // the template row, skipped
  const kal = [
    '1',
    'Z-1',
    '2026-08-03 21:14:02',
    'Shawarmania',
    '21917311',
    '268',
    '166.7502',
    'settled',
  ]
  const kan = [
    '2',
    'Z-2',
    '2026-08-04 13:05:00',
    'Shawarmania',
    '22675834',
    '500',
    '360',
    'settled',
  ]
  const aoa = [
    ['Zomato Settlement Report'],
    [],
    [],
    [], // title block, rows 1-4
    [], // row 5 group header
    [], // row 6 numbering
    header, // row 7 (index 6)
    ref,
    kal,
    kan,
  ]
  // Pad early rows so the header genuinely lands at index 6.
  while (aoa.length < 7) aoa.splice(aoa.length - 3, 0, blank)
  const wb = utils.book_new()
  utils.book_append_sheet(wb, utils.aoa_to_sheet(aoa), 'Order Level')
  utils.book_append_sheet(wb, utils.aoa_to_sheet([['Summary']]), 'Summary')
  return new Uint8Array(write(wb, { type: 'array', bookType: 'xlsx' }))
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

    it('knows a Zomato settlement by its Order Level sheet', () => {
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

  describe('Zomato settlement: a settled cycle per outlet', () => {
    it('takes commissionable as revenue and order-level payout as net, per outlet', () => {
      const parsed = parseStatement(decodeXlsx(settlementBytes()), OUTLETS)
      if (parsed.kind !== 'zomato-settlement') throw new Error('wrong kind')

      expect(parsed.cycles).toHaveLength(2)
      const kal = parsed.cycles.find((c) => c.outlet_id === 'outlet-kalyani')
      expect(kal?.cycle_state).toBe('settled')
      const order = kal?.orders[0]
      expect(order?.gross_paise).toBe(26800)
      expect(order?.net_paise).toBe(16675) // 166.7502 rounds to 16675 paise
      expect(order?.commission_paise).toBe(26800 - 16675)
      // The stated payout is the workbook's own net, so it reconciles against itself.
      expect(kal?.stated_payout_paise).toBe(16675)
      // The template #REF! row and the other outlet's order are not in this cycle.
      expect(kal?.orders).toHaveLength(1)
      expect(order?.placed_at).toBe('2026-08-03T21:14:02+05:30')
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
  hyperpureOutletId: '',
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
