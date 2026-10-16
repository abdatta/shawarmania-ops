import { describe, expect, it } from 'vitest'

import {
  checkTarget,
  orderedAt,
  paperBillId,
  parseCsv,
  parseItems,
  planOrders,
  rupees,
  rupeesToPaise,
  summarise,
  uuidv5,
} from './paper-sales.mjs'

const KAL = '00000000-0000-4000-a000-000000000001'
const outlets = [{ id: KAL, code: 'kalyani', business_day_cutover: '04:00:00' }]
const menus = new Map([
  [
    KAL,
    [
      { id: 'classic', name: 'Classic Chicken Shawarma', price_paise: 13_900 },
      { id: 'mayo', name: 'Mayonnaise Chicken Shawarma', price_paise: 15_900 },
    ],
  ],
])

const header = 'order_key,outlet,business_date,time,items,cash,upi,discount,phone,name'

describe('paper-sales: parsing a sheet', () => {
  it('reads quoted fields, CRLF and blank lines', () => {
    const rows = parseCsv(
      `${header}\r\nd1-01,kalyani,2026-10-19,19:40,"Classic Chicken Shawarma*2",278,,,,\r\n\r\n`,
    )
    expect(rows).toEqual([
      expect.objectContaining({
        line: 2,
        order_key: 'd1-01',
        items: 'Classic Chicken Shawarma*2',
        cash: '278',
        upi: '',
      }),
    ])
  })

  it('refuses a sheet without the columns it needs', () => {
    expect(() => parseCsv('order_key,outlet\nx,kalyani\n')).toThrow('"business_date"')
  })

  it('reads dishes with quantities, stated prices and free ones', () => {
    expect(
      parseItems(
        'Classic Chicken Shawarma*2; Mayonnaise Chicken Shawarma*1@150 ;Classic Chicken Shawarma * 1 free',
      ),
    ).toEqual([
      { name: 'Classic Chicken Shawarma', quantity: 2, pricePaise: null, free: false },
      { name: 'Mayonnaise Chicken Shawarma', quantity: 1, pricePaise: 15_000, free: false },
      { name: 'Classic Chicken Shawarma', quantity: 1, pricePaise: null, free: true },
    ])
    expect(() => parseItems('Classic Chicken Shawarma')).toThrow('Dish*quantity')
    expect(() => parseItems('')).toThrow('at least one dish')
  })

  it('reads rupees into integer paise', () => {
    expect(rupeesToPaise('150', 'x')).toBe(15_000)
    expect(rupeesToPaise('150.5', 'x')).toBe(15_050)
    expect(rupeesToPaise('', 'x')).toBe(0)
    expect(() => rupeesToPaise('1,50', 'cash')).toThrow('cash "1,50"')
    expect(rupees(1_234_550)).toBe('₹12,345.50')
  })
})

describe('paper-sales: identity and time', () => {
  it('derives the same bill id from the same outlet and order key', () => {
    expect(paperBillId(KAL, 'd1-01')).toBe(paperBillId(KAL, 'd1-01'))
    expect(paperBillId(KAL, 'd1-01')).not.toBe(paperBillId(KAL, 'd1-02'))
    expect(paperBillId(KAL, 'd1-01')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
  })

  it('is UUIDv5', () => {
    // RFC 4122 appendix B's example, under the DNS namespace.
    expect(uuidv5('www.example.com', '6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe(
      '2ed6657d-e927-568b-95e1-2665a8aea6a2',
    )
  })

  it('puts a time after midnight on the next calendar day', () => {
    expect(orderedAt('2026-10-19', '19:40', '04:00:00')).toBe('2026-10-19T19:40:00+05:30')
    expect(orderedAt('2026-10-19', '1:30', '04:00:00')).toBe('2026-10-20T01:30:00+05:30')
    expect(orderedAt('2026-10-31', '02:00', '04:00:00')).toBe('2026-11-01T02:00:00+05:30')
    expect(() => orderedAt('2026-10-19', '25:00')).toThrow('HH:MM')
  })
})

describe('paper-sales: planning bills', () => {
  const plan = (rows) => planOrders(parseCsv(`${header}\n${rows.join('\n')}\n`), outlets, menus)

  it('builds the payload the database takes, and the totals it will reach', () => {
    const [order] = plan(['d1-01,kalyani,2026-10-19,19:40,Classic Chicken Shawarma*2,278,,,,'])
    expect(order).toMatchObject({
      ok: true,
      billId: paperBillId(KAL, 'd1-01'),
      totalPaise: 27_800,
      cashPaise: 27_800,
      items: 2,
      payload: {
        businessDate: '2026-10-19',
        orderedAt: '2026-10-19T19:40:00+05:30',
        lines: [{ menuItemId: 'classic', quantity: 2 }],
        payments: [{ method: 'cash', amountPaise: 27_800 }],
      },
    })
  })

  it('takes a stated price, a free dish at ₹1, a bill discount, both tenders and a customer', () => {
    const [order] = plan([
      'd1-02,kalyani,2026-10-19,20:05,Classic Chicken Shawarma*1@120;Classic Chicken Shawarma*1 free,51,50,20,98300 12345,Puja Visitor',
    ])
    expect(order).toMatchObject({ ok: true, totalPaise: 10_100, discountPaise: 2_000 })
    expect(order.payload).toEqual({
      businessDate: '2026-10-19',
      orderedAt: '2026-10-19T20:05:00+05:30',
      lines: [
        { menuItemId: 'classic', quantity: 1, unitPricePaise: 12_000 },
        { menuItemId: 'classic', quantity: 1, unitPricePaise: 100 },
      ],
      payments: [
        { method: 'cash', amountPaise: 5_100 },
        { method: 'upi', amountPaise: 5_000 },
      ],
      discountPaise: 2_000,
      customerPhone: '98300 12345',
      customerName: 'Puja Visitor',
    })
  })

  it('records an order given away entirely at ₹1 a dish, as the counter does', () => {
    const [order] = plan(['d1-08,kalyani,2026-10-19,21:00,Classic Chicken Shawarma*2 free,2,,,,'])
    expect(order).toMatchObject({ ok: true, totalPaise: 200, items: 2 })
    expect(order.payload.lines).toEqual([
      { menuItemId: 'classic', quantity: 2, unitPricePaise: 100 },
    ])
    expect(() => parseItems('Classic Chicken Shawarma*1@50 free')).toThrow('both priced and free')
  })

  it('says why a row cannot be recorded, without stopping the others', () => {
    const plans = plan([
      'd1-03,kalyani,2026-10-19,19:40,Classic Chicken Shawarma*2,100,,,,',
      'd1-04,kalyani,2026-10-19,19:41,Falafel*1,100,,,,',
      'd1-05,kalyani,2026-10-19,19:42,Classic Chicken Shawarma*1,,,139,,',
      'd1-03,kalyani,2026-10-19,19:43,Classic Chicken Shawarma*1,139,,,,',
      'd1-06,kalyanee,2026-10-19,19:44,Classic Chicken Shawarma*1,139,,,,',
      'd1-07,kalyani,2026-10-19,19:45,Classic Chicken Shawarma*1,139,,,,',
    ])
    expect(plans.map((p) => (p.ok ? 'ok' : p.error))).toEqual([
      'Cash ₹100 and UPI ₹0 make ₹100, but the order comes to ₹278.',
      '"Falafel" is not on kalyani\'s menu.',
      'The discount leaves nothing. A bill comes to at least ₹1; mark free dishes free.',
      'order_key "d1-03" appears twice.',
      'No outlet has the code "kalyanee".',
      'ok',
    ])
  })

  it('totals each day by tender, and counts what is already recorded', () => {
    const plans = plan([
      'd1-01,kalyani,2026-10-19,19:40,Classic Chicken Shawarma*2,278,,,,',
      'd1-02,kalyani,2026-10-19,23:10,Mayonnaise Chicken Shawarma*1,,159,,,',
      'd2-01,kalyani,2026-10-20,01:00,Classic Chicken Shawarma*1,139,,,,',
    ])
    expect(summarise(plans, new Set([paperBillId(KAL, 'd1-01')]))).toEqual([
      {
        outlet: 'kalyani',
        businessDate: '2026-10-19',
        orders: 2,
        items: 3,
        cashPaise: 27_800,
        upiPaise: 15_900,
        discountPaise: 0,
        totalPaise: 43_700,
        alreadyRecorded: 1,
      },
      {
        outlet: 'kalyani',
        businessDate: '2026-10-20',
        orders: 1,
        items: 1,
        cashPaise: 13_900,
        upiPaise: 0,
        discountPaise: 0,
        totalPaise: 13_900,
        alreadyRecorded: 0,
      },
    ])
  })
})

describe('paper-sales: where it may write', () => {
  const anon = `x.${Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url')}.y`
  const service = `x.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.y`

  it('writes to production only when production is named', () => {
    const prod = 'https://iefcidjbfnmsiqithqbj.supabase.co'
    expect(() => checkTarget({ url: prod, anonKey: anon, target: 'staging' })).toThrow(
      'is production',
    )
    expect(() =>
      checkTarget({ url: 'https://staging.supabase.co', anonKey: anon, target: 'production' }),
    ).toThrow('not production')
    expect(() => checkTarget({ url: prod, anonKey: anon, target: 'production' })).not.toThrow()
  })

  it('refuses a service-role key', () => {
    expect(() =>
      checkTarget({ url: 'http://127.0.0.1:54321', anonKey: service, target: 'local' }),
    ).toThrow('service-role')
    expect(() =>
      checkTarget({ url: 'http://127.0.0.1:54321', anonKey: 'sb_secret_abc', target: 'local' }),
    ).toThrow('service-role')
  })

  it('needs a target', () => {
    expect(() => checkTarget({ url: 'http://127.0.0.1:54321', anonKey: anon })).toThrow('--target')
  })
})
