import { type BrowserContext, type Page } from '@playwright/test'
import { expect, test } from './test'

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
 * The app asks the server less (the-app-asks-the-server-less, D9).
 *
 * `request-budget.spec.ts` holds every build to a ceiling in both states. This
 * holds the change to the lower numbers it exists for, the same readings over
 * the same kind of rail: an idle counter and kitchen for a measured minute, and
 * one payment. The kitchen no longer re-reads its categories beside each board
 * read, each tablet's gate answers ride on its health report, and a sale neither
 * reloads a fresh menu nor refreshes once per notice. Every gate is on here, as
 * a release leaves them: the change's own gate, `fewer-requests`, has retired,
 * and the answers ride on the report only while Tablet health is on.
 *
 * Counted: every request to the Supabase origin, as the request budget counts.
 */

const SETTLE_MS = 15_000
const ACTION_WINDOW_MS = 10_000

/**
 * Measured 2026-10-15 on the local stack with every gate on, on this change's
 * working tree above `11f95c0d`, and set at one and a half times the worst
 * reading, rounded up. The request budget's own gates-on readings from before
 * this change are beside them; the request budget itself, run alongside, read
 * an ACK at 3 and a dish tick at 23 (before: 5–7 and 28–31).
 *
 * | Reading | Before (request budget, gates on) | With `fewer-requests` (3 runs) | Worst | Budget |
 * |---|---|---|---|---|
 * | Counter, an idle minute | 3, 3, 3, 3 | 2, 2, 2 | 2 | 3 |
 * | Kitchen, an idle minute | 9, 9, 9, 9 | 5, 5, 6 | 6 | 9 |
 * | Counter, one payment | 33, 42, 33, 33 | 23, 23, 23 | 23 | 35 |
 *
 * The idle budgets' headroom would hide one extra request a minute, so the two
 * reads this change removes from them are asserted absent by path as well.
 */
const BUDGET = {
  counterIdleMinute: 3,
  kitchenIdleMinute: 9,
  counterPayment: 35,
}

test.use({ actionTimeout: 30_000 })

/** Every counted request's path, in order; its length is the count. */
function recordRequests(context: BrowserContext) {
  const paths: string[] = []
  context.on('request', (request) => {
    const url = request.url()
    if (url.startsWith(SUPABASE_URL) && !url.includes('/realtime/')) {
      paths.push(new URL(url).pathname)
    }
  })
  return paths
}

const asked = (paths: string[], from: number, path: string) =>
  paths.slice(from).filter((seen) => seen === path).length

async function payOrder(page: Page, id: string) {
  await railSettled(page)
  const card = orderCard(page, id)
  await card.getByRole('button', { name: 'Paid', exact: true, pressed: false }).click()
  const payment = page.getByRole('dialog', { name: 'Record payment' })
  await payment.getByRole('button', { name: 'Cash', exact: true }).click()
  await payment.getByRole('button', { name: 'Paid', exact: true }).click()
  await expect(page.locator('dialog[open]')).toHaveCount(0)
}

test(
  'an idle counter and kitchen and a payment stay within the lower budget',
  { tag: '@cg-on:tablet-health' },
  async ({ browser, request }) => {
    test.setTimeout(6 * 60_000)

    await setSpareTillInService(request, true)
    await setSpareKind(request, 'kitchen')
    const kitchen = await openKitchen(browser, request)
    const counter = await openTill(browser, request, TILL_ONE)
    const counterPaths = recordRequests(counter.context)
    const kitchenPaths = recordRequests(kitchen.context)
    const counterRequests = () => counterPaths.length
    const kitchenRequests = () => kitchenPaths.length

    try {
      const ids: string[] = []
      for (let i = 1; i <= 4; i += 1) ids.push(await ringOrder(counter.page, `Fewer ${i}`))
      for (const id of ids) {
        await expect(kitchen.page.locator(`[data-order-id="${id}"]`)).toBeVisible({
          timeout: 30_000,
        })
      }
      await railSettled(counter.page)
      await counter.page.waitForTimeout(SETTLE_MS)

      const idleCounter = counterRequests()
      const idleKitchen = kitchenRequests()
      await counter.page.waitForTimeout(60_000)
      const counterIdleMinute = counterRequests() - idleCounter
      const kitchenIdleMinute = kitchenRequests() - idleKitchen

      // The two on-path claims a budget's headroom could hide: neither tablet
      // reads the gates on its own (their answers ride on the health report),
      // and the kitchen does not re-read its categories beside its board.
      expect(asked(counterPaths, idleCounter, '/rest/v1/change_gates'), 'counter gate reads').toBe(
        0,
      )
      expect(asked(kitchenPaths, idleKitchen, '/rest/v1/change_gates'), 'kitchen gate reads').toBe(
        0,
      )
      expect(
        asked(counterPaths, idleCounter, '/rest/v1/rpc/report_device_health_v2'),
        'counter health reports, each bringing the answers',
      ).toBeGreaterThanOrEqual(1)
      expect(
        asked(kitchenPaths, idleKitchen, '/rest/v1/menu_categories'),
        'kitchen category reads',
      ).toBe(0)

      const beforePayment = counterRequests()
      await payOrder(counter.page, ids[0]!)
      await counter.page.waitForTimeout(ACTION_WINDOW_MS)
      const counterPayment = counterRequests() - beforePayment
      // A sale's two or three notices reload the menu at most once, and only
      // when it is more than two minutes old; off, each notice reloads it.
      expect(
        asked(counterPaths, beforePayment, '/rest/v1/menu_items'),
        'counter menu reloads on a sale',
      ).toBeLessThanOrEqual(1)

      const measured = { counterIdleMinute, kitchenIdleMinute, counterPayment }
      console.log(`fewer requests readings: ${JSON.stringify(measured)}`)
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
  },
)
