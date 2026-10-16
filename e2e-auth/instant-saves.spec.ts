import { type Page } from '@playwright/test'
import { expect, test } from './test'

import { TILL_ONE, openTill, orderCard, railSettled, saveNewOrder } from './tills'

/**
 * The counter shows what it saved before the server answers
 * (the-counter-shows-what-it-saved), on the local stack with a slow server.
 *
 * Every read of `orders` and `bills` is held for five seconds, the way a weak
 * connection holds them, and every call to a database function is held until
 * the end. The functions are the commands themselves (`create_billing_order_v2`,
 * `pay_billing_order` and the rest) and the reads that ride with a re-read (the
 * till labels). Each save must be on screen within one second, so nothing here
 * can pass by waiting the server out. `@cg-on:instant-saves` because with the
 * gate off each of these waits for the held read, which is the behaviour this
 * change turns off.
 *
 * The outbox sends a command about two seconds after it is saved, and the
 * steps below take less than that, so the test waits for the order's command to
 * be out and held before it edits, pays and takes back. Without that wait no
 * command is in flight during any save, and holding them proves nothing.
 * Added on 2026-10-15, after a throttled look seemed to show an order waiting
 * for its command; that look was the harness, and this keeps the question
 * answered.
 *
 * The tablet boots with every gate on and reloads into the database's answer at
 * its first free moment if that differs. A reload here empties what the tablet
 * holds while every read is held. It failed on Staging from 2026-10-15 at
 * whichever step that reload landed on, because the round trips in
 * `dish-ticks.spec.ts` left `instant-saves` off; the suite's `./test` now checks
 * before every test that no spec left a gate turned.
 */

const SLOW_MS = 5_000
const AT_ONCE = { timeout: 1_000 }
const CLASSIC = 'Classic Chicken Shawarma'
const MAYONNAISE = 'Mayonnaise Chicken Shawarma'

/**
 * Hold every read the counter makes after a save for five seconds, and every
 * database function it calls until the test restores the server. `held` counts
 * the functions waiting in the hold right now.
 */
async function slowServer(page: Page) {
  const held = new Map<string, number>()
  let release!: () => void
  const released = new Promise<void>((resolve) => (release = resolve))
  const slow = async (route: Parameters<Parameters<Page['route']>[1]>[0]) => {
    const request = route.request()
    const rpc = request.url().split('/rest/v1/rpc/')[1]?.split('?')[0]
    if (rpc) {
      held.set(rpc, (held.get(rpc) ?? 0) + 1)
      await released
      held.set(rpc, held.get(rpc)! - 1)
    } else if (request.method() === 'GET') {
      await new Promise((resolve) => setTimeout(resolve, SLOW_MS))
    }
    // The page may have dropped the request while it was held, or the test
    // already restored the server: either way there is nothing left to send.
    await route.continue().catch(() => undefined)
  }
  await page.route('**/rest/v1/orders?**', slow)
  await page.route('**/rest/v1/bills?**', slow)
  await page.route('**/rest/v1/rpc/**', slow)
  return {
    held,
    /** Answer everything held, and stop holding. Safe to call twice. */
    restore: async () => {
      release()
      await page.unroute('**/rest/v1/orders?**')
      await page.unroute('**/rest/v1/bills?**')
      await page.unroute('**/rest/v1/rpc/**')
    },
  }
}

test(
  'an order, its edit, its payment and its take-back are on screen before a slow server answers',
  { tag: '@cg-on:instant-saves' },
  async ({ browser, request }) => {
    test.slow()
    const counter = await openTill(browser, request, TILL_ONE)
    const page = counter.page
    let server: Awaited<ReturnType<typeof slowServer>> | undefined
    try {
      await railSettled(page)
      const bills = page.getByRole('region', { name: 'Bills this shift' })
      await expect(bills).toBeVisible()
      server = await slowServer(page)
      const { held, restore } = server

      // Order: on the rail at once, numberless until the server numbers it.
      await page.getByRole('button', { name: CLASSIC, exact: true }).click()
      await page.getByRole('button', { name: 'Enter Customer Info', exact: true }).click()
      await page
        .getByRole('dialog', { name: 'Customer' })
        .getByRole('button', { name: 'Skip', exact: true })
        .click()
      const id = await saveNewOrder(
        page,
        async () => {
          await page.getByRole('button', { name: 'Order', exact: true }).click()
        },
        AT_ONCE,
      )
      const card = orderCard(page, id)
      await expect(card).toContainText(CLASSIC, AT_ONCE)

      // The order's command is on its way and the server has not answered it.
      await expect.poll(() => held.get('create_billing_order_v2') ?? 0).toBeGreaterThan(0)

      // Save changes, before the server has numbered it: the new dish at once.
      await card.getByRole('button', { name: /^More actions for / }).click()
      await card.getByRole('menuitem', { name: 'Edit', exact: true }).click()
      await page.getByRole('button', { name: MAYONNAISE, exact: true }).click()
      await page.getByTestId('save-order').click()
      await expect(card).toContainText(MAYONNAISE, AT_ONCE)

      // Every dish handed over, then paid: the ticket is in Bills at once.
      const billsBefore = await bills.locator('details').count()
      // A ticked dish's button becomes Untick, so the first Tick left each time.
      const ticks = card.getByRole('button', { name: /^Tick / })
      for (let left = await ticks.count(); left > 0; left -= 1) {
        await ticks.first().click()
        await expect(ticks).toHaveCount(left - 1, AT_ONCE)
      }
      await card.getByRole('button', { name: 'Paid', exact: true }).click()
      const receipt = page.getByRole('dialog', { name: 'Receipt and points' })
      const payment = page.getByRole('dialog', { name: 'Record payment' })
      await expect(receipt.or(payment)).toBeVisible()
      if (await receipt.isVisible())
        await receipt.getByRole('button', { name: 'Skip', exact: true }).click()
      await payment.getByRole('button', { name: 'Cash', exact: true }).click()
      await payment.getByRole('button', { name: 'Paid', exact: true }).click()
      await expect(payment).toHaveCount(0)
      await expect(card).toHaveCount(0, AT_ONCE)
      await expect(bills.locator('details')).toHaveCount(billsBefore + 1, AT_ONCE)

      // Taken back from Bills: the order is back on the rail at once.
      const row = bills.locator('details').first()
      await row.locator('summary').click()
      await row.getByRole('button', { name: 'Take the payment back', exact: true }).click()
      const takeBack = page.getByRole('dialog', { name: /^Take back the payment for/ })
      await takeBack.getByPlaceholder('Why is this payment coming back?').fill('Wrong order')
      await takeBack.getByRole('button', { name: 'Take it back', exact: true }).click()
      await expect(
        page.getByText('The payment was taken back and the order reopened.'),
      ).toBeVisible(AT_ONCE)
      await expect(orderCard(page, id)).toBeVisible(AT_ONCE)
      await expect(bills.locator('details')).toHaveCount(billsBefore, AT_ONCE)

      // All of that while the server had still not answered the order's command.
      expect(held.get('create_billing_order_v2')).toBeGreaterThan(0)

      // The server, once it answers, numbers the order where it already stands.
      await restore()
      await expect(orderCard(page, id).getByTestId(/^order-reference-/)).toHaveText(/^#\s*\d+$/, {
        timeout: 30_000,
      })
    } finally {
      // A held request left waiting keeps the context from closing until the
      // test times out, so a failure would read as the 270 s timeout.
      await server?.restore()
      await counter.context.close()
    }
  },
)
