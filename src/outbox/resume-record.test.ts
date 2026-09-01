import 'fake-indexeddb/auto'

import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { BillingDeliveryDatabase } from './schema'
import { CounterResumeCoordinator } from './resume-coordinator'
import {
  COUNTER_RESUME_SCHEMA_VERSION,
  REMEMBERED_CUSTOMER_LIMIT,
  counterResumeStopAt,
  readCounterResume,
  retainRememberedCustomers,
  writeCounterResume,
  type CounterResumeRecord,
} from './resume-record'

const names = new Set<string>()
const name = () => {
  const value = `counter-resume-${crypto.randomUUID()}`
  names.add(value)
  return value
}

function record(overrides: Partial<CounterResumeRecord> = {}): CounterResumeRecord {
  return {
    tabletId: 'tablet-1',
    schemaVersion: COUNTER_RESUME_SCHEMA_VERSION,
    complete: true,
    tablet: { id: 'tablet-1', label: 'Till one', outletId: 'outlet-1' },
    shift: {
      id: 'shift-1',
      personId: 'person-1',
      outletId: 'outlet-1',
      openedAt: '2026-09-01T12:00:00.000Z',
      businessDate: '2026-09-01',
      expiresAt: '2026-09-02T00:00:00.000Z',
    },
    // The shape Postgres `time` actually reaches the client as, through
    // PostgREST: `HH:MM:SS`, never `HH:MM`.
    outlet: {
      id: 'outlet-1',
      business_day_cutover: '04:00:00',
    } as CounterResumeRecord['outlet'],
    menu: [],
    pipeline: [],
    bills: [],
    rememberedCustomers: {},
    lastSuccessfulReadAt: '2026-09-01T13:00:00.000Z',
    serverObservedAt: '2026-09-01T13:00:00.000Z',
    deviceObservedAt: '2026-09-01T13:00:00.000Z',
    ...overrides,
  }
}

afterEach(async () => {
  await Promise.all([...names].map((databaseName) => Dexie.delete(databaseName)))
  names.clear()
})

describe('counter resume record', () => {
  it('does not publish until every authorised read slice has arrived', async () => {
    const database = new BillingDeliveryDatabase(name())
    const session = {
      kind: 'counter-device' as const,
      device: { deviceId: 'tablet-1', label: 'Till one', outletId: 'outlet-1' },
      shift: {
        id: 'shift-1',
        personId: 'person-1',
        outletId: 'outlet-1',
        openedAt: '2026-09-01T12:00:00.000Z',
        businessDate: '2026-09-01',
        expiresAt: '2026-09-02T00:00:00.000Z',
      },
    }
    const coordinator = new CounterResumeCoordinator(session, database)
    coordinator.noteMenu('outlet-1', [])
    coordinator.notePipeline('outlet-1', [])
    coordinator.noteBills('shift-1', [])
    coordinator.noteServerTime('2026-09-01T12:30:00.000Z', '2026-09-01T12:30:01.000Z')
    await vi.waitFor(async () => expect(await database.resumeRecords.count()).toBe(0))

    coordinator.noteOutlet(record().outlet)
    await vi.waitFor(async () => expect(await database.resumeRecords.count()).toBe(1))
    expect((await database.resumeRecords.get('tablet-1'))?.complete).toBe(true)
  })

  it('publishes from an outlet row in the shape PostgREST actually returns', async () => {
    // The first release of this feature built the cutover instant by pasting
    // `:00` onto `business_day_cutover`. `outlets.business_day_cutover` is a
    // Postgres `time`, so PostgREST returns `04:00:00`, the paste produced
    // `04:00:00:00`, and every write threw — silently, into an unawaited
    // promise chain, so no record was ever persisted in production.
    const database = new BillingDeliveryDatabase(name())
    const session = {
      kind: 'counter-device' as const,
      device: { deviceId: 'tablet-1', label: 'Till one', outletId: 'outlet-1' },
      shift: {
        id: 'shift-1',
        personId: 'person-1',
        outletId: 'outlet-1',
        openedAt: '2026-09-01T12:00:00.000Z',
        businessDate: '2026-09-01',
        expiresAt: '2026-09-02T00:00:00.000Z',
      },
    }
    const coordinator = new CounterResumeCoordinator(session, database)
    coordinator.noteMenu('outlet-1', [])
    coordinator.notePipeline('outlet-1', [])
    coordinator.noteBills('shift-1', [])
    coordinator.noteServerTime('2026-09-01T12:30:00.000Z')
    coordinator.noteOutlet({
      id: 'outlet-1',
      business_day_cutover: '04:00:00',
    } as CounterResumeRecord['outlet'])

    await vi.waitFor(async () => expect(await database.resumeRecords.count()).toBe(1))
    const stored = await database.resumeRecords.get('tablet-1')
    expect(stored?.outlet.business_day_cutover).toBe('04:00:00')
    // The stop is the shift expiry the server authored, and it parses.
    expect(Number.isFinite(counterResumeStopAt(stored!))).toBe(true)
  })

  it('publishes a complete record atomically and reads a defensive copy', async () => {
    const database = new BillingDeliveryDatabase(name())
    const source = record()
    await writeCounterResume(source, database)

    const read = await readCounterResume('tablet-1', Date.parse('2026-09-01T14:00:00Z'), database)
    expect(read.status).toBe('ready')
    if (read.status !== 'ready') return
    read.record.tablet.label = 'changed by caller'
    expect((await database.resumeRecords.get('tablet-1'))?.tablet.label).toBe('Till one')
  })

  it('refuses incomplete, unsupported, foreign and expired records without erasing them', async () => {
    const database = new BillingDeliveryDatabase(name())
    // Version is read before shape, so a record a newer build wrote is
    // unsupported rather than malformed however little of it we recognise.
    await database.table('resumeRecords').put({ tabletId: 'tablet-1', complete: false })
    expect((await readCounterResume('tablet-1', Date.now(), database)).status).toBe('unsupported')

    await database.table('resumeRecords').put({
      tabletId: 'tablet-1',
      schemaVersion: COUNTER_RESUME_SCHEMA_VERSION,
      complete: false,
    })
    expect((await readCounterResume('tablet-1', Date.now(), database)).status).toBe('incomplete')

    await database.resumeRecords.put(record({ schemaVersion: 999 }))
    expect((await readCounterResume('tablet-1', Date.now(), database)).status).toBe('unsupported')
    expect(await database.resumeRecords.get('tablet-1')).toBeDefined()

    await database.resumeRecords.put(
      record({ tablet: { id: 'tablet-2', label: 'Other', outletId: 'outlet-1' } }),
    )
    expect((await readCounterResume('tablet-1', Date.now(), database)).status).toBe('foreign')

    await database.resumeRecords.put(record())
    expect(
      (await readCounterResume('tablet-1', Date.parse('2026-09-02T00:30:00Z'), database)).status,
    ).toBe('expired')
  })

  it('stops at the shift expiry the server authored, which is the outlet cutover', () => {
    expect(counterResumeStopAt(record())).toBe(Date.parse('2026-09-02T00:00:00.000Z'))
    expect(
      counterResumeStopAt(
        record({ shift: { ...record().shift, expiresAt: '2026-09-01T22:30:00.000Z' } }),
      ),
    ).toBe(Date.parse('2026-09-01T22:30:00.000Z'))
  })

  it('caps exact-phone results by age and count without logging PII', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const now = Date.parse('2026-09-01T12:00:00.000Z')
    const customers = Object.fromEntries(
      Array.from({ length: REMEMBERED_CUSTOMER_LIMIT + 2 }, (_, index) => {
        const phone = `+91900000${String(index).padStart(4, '0')}`
        return [
          phone,
          {
            id: `customer-${index}`,
            phone,
            name: `Customer ${index}`,
            rememberedAt: new Date(now - index * 1000).toISOString(),
          },
        ]
      }),
    )
    customers['+919999999999'] = {
      id: 'old',
      phone: '+919999999999',
      name: 'Old',
      rememberedAt: '2026-08-01T00:00:00.000Z',
    }

    const retained = retainRememberedCustomers(customers, now)
    expect(Object.keys(retained)).toHaveLength(REMEMBERED_CUSTOMER_LIMIT)
    expect(retained).not.toHaveProperty('+919999999999')
    expect(log).not.toHaveBeenCalled()
    log.mockRestore()
  })
})
