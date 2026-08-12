import { FunctionsFetchError, FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'

import type { Database } from '../database.types'
import { createSupabaseCounterAdapter } from './counter'

/**
 * The real adapter against a stubbed client, aimed at one thing: **what a
 * failure is called.**
 *
 * On 2026-08-11 an owner tried to register a tablet from their own phone and
 * was told to check their internet connection. `counter-devices` had never been
 * deployed, so the platform gateway answered 404 in a few milliseconds with a
 * body carrying `code` and `message` and no `error` key. `failureCode` returns
 * null for that shape, and `?? 'unavailable'` read null as evidence of a
 * transport failure it had no evidence for.
 *
 * The rule these tests pin is the one `unreachable-backend-sign-in-error` (#30)
 * set for sign-in: classify on positive evidence, and where there is none, say
 * the honest unknown rather than the specific-sounding guess.
 *
 * What is deliberately NOT here: whether any of these actions is permitted.
 * That is the database's and the Edge Function's, and it is proved in
 * `supabase/tests/rest/counter-handshake.test.ts` against a real backend. This
 * file cannot prove a policy and does not pretend to.
 */

function adapterWith(invoke: ReturnType<typeof vi.fn>) {
  const client = { functions: { invoke } } as unknown as SupabaseClient<Database>
  return createSupabaseCounterAdapter(client)
}

const answering = (error: unknown) => vi.fn().mockResolvedValue({ data: null, error })

function httpError(body: unknown, status: number): FunctionsHttpError {
  return new FunctionsHttpError(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  )
}

/** Exactly what the platform gateway answers for a function that is not deployed. */
const NOT_DEPLOYED = () =>
  httpError({ code: 'NOT_FOUND', message: 'Requested function was not found' }, 404)

const CONNECTION = 'Could not reach Shawarmania. Try again in a moment.'
const UNSENDABLE = 'This app could not send that action. Nothing was recorded. Please report this.'

describe('generating a setup code when the function is missing', () => {
  it('does not tell an owner to check their internet connection', async () => {
    // The reported bug, reproduced at the seam it happened at.
    const counter = adapterWith(answering(NOT_DEPLOYED()))

    await expect(counter.issueSetupCode('outlet-1', 'Counter tablet')).rejects.toMatchObject({
      code: 'unsendable',
      message: UNSENDABLE,
    })
  })

  it('does not offer it as something to try again in a moment', async () => {
    const counter = adapterWith(answering(NOT_DEPLOYED()))
    const cause = await counter.issueSetupCode('outlet-1', 'Counter tablet').catch((e) => e)

    expect(cause.message).not.toMatch(/try again/i)
    expect(cause.message).not.toMatch(/reach shawarmania/i)
  })
})

describe('classifying a counter action failure', () => {
  it('calls a genuine transport failure a connection problem', async () => {
    // The only positive evidence supabase-js gives that no response arrived.
    const counter = adapterWith(
      answering(new FunctionsFetchError(new TypeError('failed to fetch'))),
    )

    await expect(counter.issueSetupCode('outlet-1', 'Tablet')).rejects.toMatchObject({
      code: 'unavailable',
      message: CONNECTION,
    })
  })

  it.each([
    ['forbidden', 403, 'You are not allowed to do that.'],
    ['tablet_exists', 409, 'This outlet already has a tablet. Remove that one first.'],
  ])('keeps the named refusal %s exactly as it was', async (reason, status, message) => {
    const counter = adapterWith(answering(httpError({ error: reason }, status)))

    await expect(counter.issueSetupCode('outlet-1', 'Tablet')).rejects.toMatchObject({
      code: reason,
      message,
    })
  })

  it('calls a 500 with no readable reason unsendable, not unreachable', async () => {
    const counter = adapterWith(answering(httpError({ message: 'boom' }, 500)))

    await expect(counter.removeDevice('device-1')).rejects.toMatchObject({ code: 'unsendable' })
  })

  it('calls a body that is not JSON at all unsendable', async () => {
    const counter = adapterWith(
      answering(new FunctionsHttpError(new Response('<html>502</html>', { status: 502 }))),
    )

    await expect(counter.removeDevice('device-1')).rejects.toMatchObject({ code: 'unsendable' })
  })

  it('applies the same rule to every action, not just the one that was reported', async () => {
    // The bug was found through `issueSetupCode`; it lived in the shared
    // `call` helper, so every write had it.
    const counter = adapterWith(answering(NOT_DEPLOYED()))

    await expect(counter.confirmShift('request-1', '1234')).rejects.toMatchObject({
      code: 'unsendable',
    })
    await expect(counter.rejectRequest('request-1')).rejects.toMatchObject({ code: 'unsendable' })
    await expect(counter.endShift('shift-1')).rejects.toMatchObject({ code: 'unsendable' })
    await expect(counter.requestShift('someone')).rejects.toMatchObject({ code: 'unsendable' })
    await expect(counter.cancelRequest()).rejects.toMatchObject({ code: 'unsendable' })
  })

  it('leaves a successful call untouched', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValue({ data: { code: 'ABCDE-FGHJK', validFor: '15 mins' }, error: null })

    await expect(adapterWith(invoke).issueSetupCode('outlet-1', 'Tablet')).resolves.toEqual({
      code: 'ABCDE-FGHJK',
      validFor: '15 mins',
    })
    expect(invoke).toHaveBeenCalledWith('counter-devices', {
      body: { action: 'issue-setup-code', outletId: 'outlet-1', label: 'Tablet' },
    })
  })
})

describe('the shared outlet billing channel', () => {
  it('subscribes once to menu and rail tables, then removes the channel with the last reader', () => {
    const handlers: Array<() => void> = []
    const on = vi.fn((_kind, _filter, handler: () => void) => {
      handlers.push(handler)
      return channel
    })
    const subscribe = vi.fn(() => channel)
    const channel = { on, subscribe }
    const client = {
      functions: { invoke: vi.fn() },
      channel: vi.fn(() => channel),
      removeChannel: vi.fn().mockResolvedValue('ok'),
    } as unknown as SupabaseClient<Database>
    const counter = createSupabaseCounterAdapter(client)
    const first = vi.fn()
    const second = vi.fn()

    const leaveFirst = counter.subscribeToOutletBilling('outlet-1', first)
    const leaveSecond = counter.subscribeToOutletBilling('outlet-1', second)

    expect(client.channel).toHaveBeenCalledTimes(1)
    expect(on.mock.calls.map((call) => call[1])).toEqual([
      { event: '*', schema: 'public', table: 'menu_categories', filter: 'outlet_id=eq.outlet-1' },
      { event: '*', schema: 'public', table: 'menu_items', filter: 'outlet_id=eq.outlet-1' },
      { event: '*', schema: 'public', table: 'orders', filter: 'outlet_id=eq.outlet-1' },
      { event: '*', schema: 'public', table: 'bills', filter: 'outlet_id=eq.outlet-1' },
    ])
    handlers[0]?.()
    expect(first).toHaveBeenCalledOnce()
    expect(second).toHaveBeenCalledOnce()

    leaveFirst()
    expect(client.removeChannel).not.toHaveBeenCalled()
    leaveSecond()
    expect(client.removeChannel).toHaveBeenCalledWith(channel)
  })
})

describe('the remote counter snapshot', () => {
  it('maps one RLS-scoped database read without customer or bill contents', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          read_at: '2026-08-12T10:05:00.000Z',
          device_id: 'device-1',
          outlet_id: 'outlet-1',
          label: 'Kalyani counter tablet',
          set_up_at: '2026-08-01T10:00:00.000Z',
          last_seen_at: '2026-08-12T10:04:00.000Z',
          last_reported_unsent: 0,
          shift_id: 'shift-1',
          operator_name: 'Counter Biller',
          opened_at: '2026-08-12T06:00:00.000Z',
          business_date: '2026-08-12',
          bill_count: 4,
          cash_total_paise: 34_800,
          upi_total_paise: 20_000,
          open_order_count: 2,
          drawer_cash_paise: 34_800,
        },
      ],
      error: null,
    })
    const client = { rpc } as unknown as SupabaseClient<Database>

    await expect(
      createSupabaseCounterAdapter(client).readDeviceOperations(['outlet-1']),
    ).resolves.toEqual([
      {
        id: 'device-1',
        outletId: 'outlet-1',
        label: 'Kalyani counter tablet',
        setUpAt: '2026-08-01T10:00:00.000Z',
        lastSeenAt: '2026-08-12T10:04:00.000Z',
        lastReportedUnsent: 0,
        readAt: '2026-08-12T10:05:00.000Z',
        operations: {
          shiftId: 'shift-1',
          operatorName: 'Counter Biller',
          openedAt: '2026-08-12T06:00:00.000Z',
          businessDate: '2026-08-12',
          billCount: 4,
          cashTotalPaise: 34_800,
          upiTotalPaise: 20_000,
          openOrderCount: 2,
          drawerCashPaise: 34_800,
        },
      },
    ])
    expect(rpc).toHaveBeenCalledWith('counter_operations_snapshot', {
      p_outlet_ids: ['outlet-1'],
    })
  })
})
