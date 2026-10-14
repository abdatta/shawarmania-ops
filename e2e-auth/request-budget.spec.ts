import { type BrowserContext, type Page } from '@playwright/test'
import { expect, test } from './test'

import { GATE_STATE } from '../e2e/support/change-gates'

import {
  SUPABASE_URL,
  TILL_ONE,
  openKitchen,
  openTill,
  orderCard,
  railSettled,
  ringOrder,
  setSpareKind,
  setSpareTillInService,
} from './tills'

/**
 * The counter stays cheap to run (a-release-can-be-switched-off, D10).
 *
 * On 12 October #74 took the counter from about 40 requests a minute to about
 * 600 — three one-second loops, none waiting for the last — and the smallest
 * Supabase compute ran out of CPU under it. Every test passed, because no test
 * counted. This one does: a counter and a kitchen over a realistic rail, idle
 * for a measured minute, then one ACK and one payment, each counted against a
 * budget. It runs with every gate off and with every gate on.
 *
 * Counted: every request to the Supabase origin — REST, RPC, auth, functions.
 * Not counted: the Realtime socket, which is one connection, not a stream of
 * requests. A change that needs more raises the budget in its own diff, where a
 * reviewer sees the number move.
 */

/** Requests after the rail has settled and nothing has been touched, before measuring. */
const SETTLE_MS = 15_000
/** The window an action is counted over: long enough for every read it causes. */
const ACTION_WINDOW_MS = 10_000

/**
 * Measured 2026-10-13 on the local stack at `e38f420f`, the build before any
 * gated change, and set at one and a half times the worst reading, rounded up.
 *
 * | Reading | Gates off (4 runs) | Gates on (3 runs) | Worst | Budget |
 * |---|---|---|---|---|
 * | Counter, an idle minute | 2, 2, 2, 2 | 3, 3, 3 | 3 | 5 |
 * | Kitchen, an idle minute | 8, 8, 8, 8 | 9, 9, 9 | 9 | 14 |
 * | Kitchen, one ACK | 5, 5, 7, 5 | 7, 7, 7 | 7 | 11 |
 * | Counter, one payment | 33, 42, 33, 33 | 42, 33, 33 | 42 | 63 |
 *
 * Gates on adds one request a minute on each tablet: the minute's re-read of the
 * change gates. #74's counter made about 600 requests a minute in production.
 *
 * One dish tick (each-dish-is-ticked-off, R5) was added 2026-10-14 on the local
 * stack at `013ae06b`, with the same idle, ACK and payment readings taken again
 * beside it, and its budget set the same way. Gates off a dish has no tick, so the
 * same hand taps Prepared on a third card: logged as `counterPreparedTap`, with no
 * budget, to show a tick costs what the tap it replaces costs.
 *
 * | Reading | Gates off (3 runs) | Gates on (4 runs) | Worst | Budget |
 * |---|---|---|---|---|
 * | Counter, an idle minute | 2, 2, 2 | 3, 3, 3, 3 | 3 | 5 |
 * | Kitchen, an idle minute | 8, 8, 8 | 9, 9, 9, 9 | 9 | 14 |
 * | Kitchen, one ACK | 5, 5, 5 | 5, 5, 7, 5 | 7 | 11 |
 * | Counter, one payment | 42, 33, 42 | 33, 42, 33, 33 | 42 | 63 |
 * | Counter, one Prepared tap | 27, 27, 27 | (not taken) | 27 | none |
 * | Counter, one dish tick | (not taken) | 28, 28, 31, 28 | 31 | 47 |
 *
 * The four existing budgets held in both states, unraised.
 */
const BUDGET = {
  counterIdleMinute: 5,
  kitchenIdleMinute: 14,
  kitchenAck: 11,
  counterPayment: 63,
  /** Gates on only: one dish ticked on a rail card (each-dish-is-ticked-off, R5). */
  counterDishTick: 47,
}

// A click with no limit waits out the whole test when its target never comes;
// thirty seconds fails at the step that stuck, naming it.
test.use({ actionTimeout: 30_000 })

function countRequests(context: BrowserContext) {
  let count = 0
  context.on('request', (request) => {
    const url = request.url()
    if (url.startsWith(SUPABASE_URL) && !url.includes('/realtime/')) count += 1
  })
  return () => count
}

async function counted(read: () => number, during: () => Promise<void>) {
  const before = read()
  await during()
  return read() - before
}

async function payOrder(page: Page, id: string) {
  await railSettled(page)
  const card = orderCard(page, id)
  await card.getByRole('button', { name: 'Paid', exact: true, pressed: false }).click()
  const payment = page.getByRole('dialog', { name: 'Record payment' })
  await payment.getByRole('button', { name: 'Cash', exact: true }).click()
  await payment.getByRole('button', { name: 'Paid', exact: true }).click()
  await expect(page.locator('dialog[open]')).toHaveCount(0)
}

test('an idle counter and kitchen, an ACK and a payment each stay within their request budget', async ({
  browser,
  request,
}) => {
  test.setTimeout(8 * 60_000)

  await setSpareTillInService(request, true)
  await setSpareKind(request, 'kitchen')
  const kitchen = await openKitchen(browser, request)
  const counter = await openTill(browser, request, TILL_ONE)
  const counterRequests = countRequests(counter.context)
  const kitchenRequests = countRequests(kitchen.context)

  try {
    // A realistic rail: eight open orders, each alerting at the kitchen.
    const ids: string[] = []
    for (let i = 1; i <= 8; i += 1) ids.push(await ringOrder(counter.page, `Budget ${i}`))
    for (const id of ids) {
      await expect(kitchen.page.locator(`[data-order-id="${id}"]`)).toBeVisible({
        timeout: 30_000,
      })
    }
    await railSettled(counter.page)
    await counter.page.waitForTimeout(SETTLE_MS)

    // Idle: nobody touches either tablet for a minute.
    const idleCounter = counterRequests()
    const idleKitchen = kitchenRequests()
    await counter.page.waitForTimeout(60_000)
    const counterIdleMinute = counterRequests() - idleCounter
    const kitchenIdleMinute = kitchenRequests() - idleKitchen

    // One ACK at the kitchen.
    const kitchenAck = await counted(kitchenRequests, async () => {
      const card = kitchen.page.locator(`[data-order-id="${ids[0]}"]`)
      await card.getByRole('button', { name: /^ACK order / }).click()
      await expect(card).toHaveAttribute('data-state', 'quiet')
      await kitchen.page.waitForTimeout(ACTION_WINDOW_MS)
    })

    // One payment at the counter.
    const counterPayment = await counted(counterRequests, async () => {
      await payOrder(counter.page, ids[1]!)
      await counter.page.waitForTimeout(ACTION_WINDOW_MS)
    })

    // One tick of the dish on a third card. Gates on, that is `dish-ticks`' tick
    // (the rail reloads after its own write, the kitchen pulse brings the marks);
    // gates off the dish has no tick, so the same hand taps Prepared instead --
    // recorded for comparison, with no budget of its own.
    const tapped = await counted(counterRequests, async () => {
      await railSettled(counter.page)
      const card = orderCard(counter.page, ids[2]!)
      if (GATE_STATE === 'on') {
        await card.getByRole('button', { name: /^Tick / }).click()
      } else {
        await card.getByRole('button', { name: 'Prepared', exact: true, pressed: false }).click()
      }
      await counter.page.waitForTimeout(ACTION_WINDOW_MS)
    })

    const measured: Record<string, number> = {
      counterIdleMinute,
      kitchenIdleMinute,
      kitchenAck,
      counterPayment,
      ...(GATE_STATE === 'on' ? { counterDishTick: tapped } : {}),
    }
    console.log(
      `request budget readings: ${JSON.stringify({ ...measured, ...(GATE_STATE === 'off' ? { counterPreparedTap: tapped } : {}) })}`,
    )
    for (const [what, count] of Object.entries(measured)) {
      expect(
        count,
        `${what}: ${count} requests, budget ${BUDGET[what as keyof typeof BUDGET]}`,
      ).toBeLessThanOrEqual(BUDGET[what as keyof typeof BUDGET])
    }
  } finally {
    await kitchen.context.close()
    await counter.context.close()
    await setSpareKind(request, 'counter')
    await setSpareTillInService(request, false)
  }
})
