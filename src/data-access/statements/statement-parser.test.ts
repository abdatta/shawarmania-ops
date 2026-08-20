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
