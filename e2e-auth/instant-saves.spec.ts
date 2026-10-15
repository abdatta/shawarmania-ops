import { type Page } from '@playwright/test'
import { expect, test } from './test'

import { TILL_ONE, openTill, orderCard, railSettled, saveNewOrder } from './tills'

/**
 * The counter shows what it saved before the server answers
 * (the-counter-shows-what-it-saved), on the local stack with a slow server.
 *
 * Every read of `orders` and `bills` is held for five seconds, the way a weak
 * connection holds them; the commands themselves are not. Each save must be on
 * screen within one second, so nothing here can pass by waiting the server out.
 * `@cg-on:instant-saves` because with the gate off each of these waits for the
 * held read, which is the behaviour this change turns off.
 */

const SLOW_MS = 5_000
const AT_ONCE = { timeout: 1_000 }
const CLASSIC = 'Classic Chicken Shawarma'

/** Hold every read of the two tables the counter re-reads after a save. */
async function slowServer(page: Page) {
  const slow = async (route: Parameters<Parameters<Page['route']>[1]>[0]) => {
    if (route.request().method() === 'GET') {
      await new Promise((resolve) => setTimeout(resolve, SLOW_MS))
    }
    // The page may have dropped the request while it was held, or the test
    // already restored the server: either way there is nothing left to send.
    await route.continue().catch(() => undefined)
  }
  await page.route('**/rest/v1/orders?**', slow)
  await page.route('**/rest/v1/bills?**', slow)
  return async () => {
    await page.unroute('**/rest/v1/orders?**')
    await page.unroute('**/rest/v1/bills?**')
  }
}

test(
  'an order, its payment and its take-back are on screen before a slow server answers',
  { tag: '@cg-on:instant-saves' },
  async ({ browser, request }) => {
    test.slow()
    const counter = await openTill(browser, request, TILL_ONE)
    const page = counter.page
    try {
      await railSettled(page)
      const bills = page.getByRole('region', { name: 'Bills this shift' })
      await expect(bills).toBeVisible()
      const restore = await slowServer(page)

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

      // Every dish handed over, then paid: the ticket is in Bills at once.
      const billsBefore = await bills.locator('details').count()
      await card
        .getByRole('button', { name: /^Tick / })
        .first()
        .click()
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

      // The server, once it answers, numbers the order where it already stands.
      await restore()
      await expect(orderCard(page, id).getByTestId(/^order-reference-/)).toHaveText(/^#\s*\d+$/, {
        timeout: 30_000,
      })
    } finally {
      await counter.context.close()
    }
  },
)
