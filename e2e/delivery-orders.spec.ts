import { expect, test } from './test'

/**
 * Delivery orders in the demo (delivery-orders-are-made-not-billed), against a
 * production build and a real browser. Runs only with every gate on, where the
 * demo's Kalyani offers Delivery.
 *
 * baseURL carries the deployment sub-path, so every goto is relative.
 */

const ON = { tag: '@cg-on:delivery-orders' }

test(
  'a delivery order is saved with no money, waits for its dishes, and is handed over',
  ON,
  async ({ page }) => {
    await page.goto('demo/biller')
    const rail = page.getByTestId('counter-activity-rail')
    await expect(rail).toBeVisible()
    const ids = async () =>
      new Set(
        await rail
          .locator('[data-flip-id]')
          .evaluateAll((els) => els.map((el) => el.getAttribute('data-flip-id')!)),
      )
    const before = await ids()

    await page.getByRole('button', { name: 'Classic Chicken Shawarma', exact: true }).click()
    await page.getByTestId('service-chip-delivery').click()
    // No total, no customer and no Paid: the order's only action is Order.
    await expect(page.getByTestId('bill-total')).toHaveCount(0)
    await expect(page.getByTestId('customer-row')).toHaveCount(0)
    await expect(page.getByTestId('settle')).toHaveCount(0)
    await page.locator('#order-label').fill('ZMT 9001')
    await page.getByTestId('save-order').click()

    let id = ''
    await expect
      .poll(async () => {
        id = [...(await ids())].find((candidate) => !before.has(candidate)) ?? ''
        return id
      })
      .not.toBe('')
    const card = rail.locator(`[data-flip-id="${id}"]`)
    await expect(card.getByTestId(`order-service-${id}`)).toHaveText('Delivery')
    await expect(card).not.toContainText('₹')

    // Hand over waits for every dish to be ticked.
    const handOver = card.getByTestId(`hand-over-${id}`)
    await expect(handOver).toBeDisabled()
    await card.getByRole('button', { name: /^Tick / }).click()
    await expect(handOver).toBeEnabled()
    await handOver.click()
    // Held a moment to undo, then gone, and listed in My shift without an amount.
    await expect(handOver).toHaveAttribute('aria-pressed', 'true')
    await expect(card).toHaveCount(0, { timeout: 10_000 })
    const handed = page.getByTestId(`shift-delivery-${id}`)
    await expect(handed).toBeVisible()
    await expect(handed).toContainText('ZMT 9001')
    await expect(handed).not.toContainText('₹')
  },
)

test('the kitchen tells a delivery ticket at a glance', ON, async ({ page }) => {
  await page.goto('demo/kitchen')
  // The demo's #109 is a delivery order whose food this kitchen has made: its
  // folded ticket keeps the bike beside the number.
  await expect(page.getByLabel('DELIVERY').first()).toBeVisible()
})

test(
  'Billing history lists delivered orders on a tab of their own, without money',
  ON,
  async ({ page }) => {
    await page.goto('demo/owner/billing-history')
    await page.getByRole('tab', { name: /^Delivered/ }).click()
    const list = page.getByTestId('manager-delivery-list')
    await expect(list).toBeVisible()
    await expect(list).toContainText('Handed over')
    await expect(list).not.toContainText('₹')
  },
)
