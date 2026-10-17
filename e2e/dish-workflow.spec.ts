import { type Page } from '@playwright/test'

import { expect, test } from './test'

/**
 * Each dish is ticked off (#74), with the kitchen's Done. No assertion here is
 * about sound or about how long anything rings: the unit tests own that.
 *
 * baseURL carries the deployment sub-path, so every goto here is relative.
 */

const SHAWARMA = 'Classic Chicken Shawarma'
const MAYO = 'Mayonnaise Chicken Shawarma'

async function openCounter(page: Page) {
  await page.setViewportSize({ width: 1080, height: 810 })
  await page.goto('demo/biller')
  await expect(page.getByRole('list', { name: 'The pipeline' })).toBeVisible()
}

/** The demo's Kalyani waits for a service type, then for the customer question. */
async function sendOrder(page: Page) {
  await page.getByRole('button', { name: 'Takeaway', exact: true }).click()
  await page.getByRole('button', { name: 'Enter Customer Info', exact: true }).click()
  await page.getByRole('button', { name: 'Skip', exact: true }).click()
  await page.getByRole('button', { name: 'Order', exact: true }).click()
}

/** Ring up `dishes` under `label`, optionally with a note on the first. */
async function ringUp(page: Page, label: string, dishes: string[], note?: string) {
  for (const dish of dishes) await page.getByRole('button', { name: dish, exact: true }).click()
  await page.getByRole('textbox', { name: /Order label/ }).fill(label)
  if (note) {
    await page.getByRole('button', { name: `Note for ${dishes[0]}` }).click()
    await page.getByRole('textbox', { name: 'Dish note' }).fill(note)
    await page.getByRole('button', { name: 'Save note' }).click()
  }
  await sendOrder(page)
  const rail = page.getByRole('list', { name: 'The pipeline' })
  const card = rail.locator('article').filter({ hasText: label })
  await expect(card).toHaveCount(1)
  await expect(card).toHaveAttribute('data-testid', /^open-order-\d+$/)
  const number = (await card.getAttribute('data-testid'))!.replace('open-order-', '')
  return { card, number }
}

async function openKitchen(page: Page) {
  const kitchen = await page.context().newPage()
  await kitchen.setViewportSize({ width: 1080, height: 810 })
  await kitchen.goto('demo/kitchen')
  return kitchen
}

/** Record the order's payment from its card; nothing else is asked for. */
async function pay(page: Page, card: ReturnType<Page['locator']>) {
  await card.getByRole('button', { name: 'Paid', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Loading payment' })).toBeHidden()
  const question = page.getByRole('dialog', { name: 'Receipt and points' })
  if (await question.isVisible()) await question.getByTestId('customer-skip').click()
  const dialog = page.getByRole('dialog', { name: 'Record payment' })
  await dialog.getByRole('button', { name: 'Cash', exact: true }).click()
  await dialog.getByRole('button', { name: 'Paid', exact: true }).click()
}

test('a label and a note typed in the composer reach the rail card, and the note reaches the kitchen', async ({
  page,
}) => {
  await openCounter(page)
  const { card, number } = await ringUp(page, 'Window table', [SHAWARMA], 'No mayo')
  await expect(card.getByText('Window table', { exact: true })).toBeVisible()
  await expect(card.getByRole('button', { name: `Tick 1 ${SHAWARMA}, No mayo` })).toBeVisible()

  const kitchen = await openKitchen(page)
  const ticket = kitchen.getByTestId(`kitchen-card-${number}`)
  await expect(ticket.getByText('No mayo', { exact: true })).toBeVisible()
  // The kitchen goes by the order number: the label never reaches it.
  await expect(kitchen.getByText('Window table', { exact: true })).toHaveCount(0)
})

test('ticking a dish is its own, and the order is prepared once every dish is ticked', async ({
  page,
}) => {
  await openCounter(page)
  const { card, number } = await ringUp(page, 'Two dishes', [SHAWARMA, MAYO])
  // No whole-order Prepared toggle: the dishes are the record.
  await expect(card.getByRole('button', { name: 'Prepared', exact: true })).toHaveCount(0)
  const first = card.getByRole('button', { name: `Tick 1 ${SHAWARMA}`, exact: true })
  const second = card.getByRole('button', { name: `Tick 1 ${MAYO}`, exact: true })

  await first.click()
  await expect(
    card.getByRole('button', { name: `Untick 1 ${SHAWARMA}`, exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(second).toHaveAttribute('aria-pressed', 'false')

  const bills = page.getByRole('region', { name: 'Bills this shift' }).locator('details')
  const before = await bills.count()
  // Paid with a dish still to make: the order waits on the rail.
  await pay(page, card)
  const rail = page.getByTestId('counter-activity-rail')
  await expect(card).toHaveAttribute('data-paid', 'true')
  await expect(rail.getByTestId(`open-order-${number}`)).toBeVisible()

  // The last tick prepares it, and a prepared, paid order settles.
  await second.click()
  await expect(rail.getByTestId(`open-order-${number}`)).toHaveCount(0)
  await expect(bills).toHaveCount(before + 1)
})

test('a kitchen tab’s Done fills the counter’s dish, collapses to a receipt, and Undo takes it back', async ({
  page,
}) => {
  await openCounter(page)
  const { card, number } = await ringUp(page, 'Blue sky', [SHAWARMA])
  await expect(card.locator('li[data-ready="true"]')).toHaveCount(0)

  const kitchen = await openKitchen(page)
  const ticket = kitchen.getByTestId(`kitchen-card-${number}`)
  const done = kitchen.getByTestId(`kitchen-done-${number}-1`)
  await ticket.getByRole('button', { name: `Ready order ${number}`, exact: true }).click()
  await expect(done).toHaveAttribute('data-collapsed', 'true')
  await expect(ticket).toHaveCount(0)
  await expect(card.locator('li[data-ready="true"]')).toHaveCount(1)
  await expect(card.getByTestId('kitchen-pickup-bell')).toBeVisible()

  await done.getByRole('button', { name: `Ready order ${number}`, exact: true }).click()
  await expect(done).toHaveCount(0)
  await expect(ticket).toBeVisible()
  await expect(card.locator('li[data-ready="true"]')).toHaveCount(0)

  // Done again, then hand the dish over: ticking it clears the fill and the receipt.
  await ticket.getByRole('button', { name: `Ready order ${number}`, exact: true }).click()
  await expect(card.locator('li[data-ready="true"]')).toHaveCount(1)
  await card.getByRole('button', { name: `Tick 1 ${SHAWARMA}`, exact: true }).click()
  await expect(card.locator('li[data-ready="true"]')).toHaveCount(0)
  await expect(done).toHaveCount(0)
})

test('food added after Done is a later ticket, #N · 2, beside the Done receipt', async ({
  page,
}) => {
  await openCounter(page)
  const { card, number } = await ringUp(page, 'Late addition', [SHAWARMA])
  const kitchen = await openKitchen(page)
  await kitchen
    .getByTestId(`kitchen-card-${number}`)
    .getByRole('button', { name: `Ready order ${number}`, exact: true })
    .click()
  const done = kitchen.getByTestId(`kitchen-done-${number}-1`)
  await expect(done).toBeVisible()

  await card.getByRole('button', { name: /More actions/ }).click()
  await page.getByRole('menuitem', { name: 'Edit', exact: true }).click()
  await page.getByRole('button', { name: MAYO, exact: true }).click()
  await page.getByRole('button', { name: 'Save', exact: true }).click()

  const later = kitchen.getByTestId(`kitchen-card-${number}`)
  await expect(later).toContainText('· 2')
  await expect(later).toContainText(MAYO)
  await expect(done).toBeVisible()
})
