import { type Page } from '@playwright/test'
import { expect, test } from './test'

import { getPartState, isRenderable } from '../src/gates/registry'

/**
 * The counter, in a real browser, on the device it actually runs on.
 *
 * The gate for `ui-billing-counter` is three clauses and each has a test here:
 * a full order rung and settled on a tablet viewport, every item in reach (since
 * `billing-menu-search`, through a search over a column that scrolls rather
 * than a menu that must fit), and the UI-only gate that a customer has been
 * decided — identified from their number, or deliberately skipped.
 *
 * The offline spec is the other half — the sync indicator's three states are the
 * whole reason it exists, and the escalated one cannot be reached by looking at
 * a screenshot.
 *
 * baseURL carries the deployment sub-path, so every goto is relative.
 */

async function setTheme(page: Page, theme: 'light' | 'dark') {
  await page.evaluate((value) => {
    localStorage.setItem('shawarmania.theme', value)
  }, theme)
}

/**
 * Decide the customer the way a biller does: open the row, tap the pad, confirm.
 * The number is entered from the dialog's own keys, because the counter tablet
 * has no keyboard out and that is what the pad is for.
 */
async function identifyCustomer(page: Page, digits: string, name?: string) {
  await page.getByTestId('customer-row').click()
  const dialog = page.getByRole('dialog', { name: 'Customer' })
  for (const digit of digits) {
    await dialog.getByRole('button', { name: digit, exact: true }).click()
  }
  if (name !== undefined) {
    // `Name` while the number is new and a name is required of it, `Name
    // (optional)` for a customer who already exists without one.
    await dialog.getByPlaceholder(/name/i).fill(name)
  }
  await dialog.getByTestId('customer-confirm').click()
}

/**
 * The other decision: no number given. Two taps, both deliberate — the row,
 * then No customer. There is deliberately no skip on the composer.
 */
async function skipCustomer(page: Page) {
  await page.getByTestId('customer-row').click()
  await page.getByRole('dialog', { name: 'Customer' }).getByTestId('customer-skip').click()
}

async function skipPaymentCustomerIfAsked(page: Page) {
  await expect(page.getByRole('dialog', { name: 'Loading payment' })).toBeHidden()
  const question = page.getByRole('dialog', { name: 'Receipt and points' })
  if (await question.isVisible()) await question.getByTestId('customer-skip').click()
}

async function recordPaid(page: Page, method = 'Cash') {
  await page.getByTestId('settle').click()
  await skipPaymentCustomerIfAsked(page)
  const dialog = page.getByRole('dialog', { name: 'Record payment' })
  await dialog.getByRole('button', { name: method, exact: true }).click()
  await dialog.getByRole('button', { name: 'Paid', exact: true }).click()
}

/**
 * Save the composer's order and return the id of the card it made.
 *
 * A pipeline card no longer prints its customer, so a test cannot find its own
 * order by the name it gave. The id is the counter's own UUID and survives
 * delivery, when `open-order-local-*` becomes `open-order-<n>`, so the card is
 * the one id the rail did not hold before the save.
 */
async function saveNewOrder(page: Page): Promise<string> {
  const cards = page.getByTestId('counter-activity-rail').locator('[data-flip-id]')
  const ids = async () =>
    new Set(await cards.evaluateAll((els) => els.map((el) => el.getAttribute('data-flip-id')!)))
  const before = await ids()
  await page.getByTestId('save-order').click()
  let added: string[] = []
  await expect
    .poll(async () => (added = [...(await ids())].filter((id) => !before.has(id))).length)
    .toBe(1)
  return added[0]!
}

/** Kalyani, from the outlet fixture: where the demo's counter stands. */
const KALYANI = 'd0000000-0000-4000-a000-000000000001'

/** Back to the counter through the demo banner, which keeps the demo's state. */
async function switchToBiller(page: Page) {
  const switcher = page.getByRole('navigation', { name: 'Demo role switcher' })
  const select = switcher.getByRole('combobox', { name: 'Demo role' })
  if (await select.isVisible()) await select.selectOption('biller')
  else await switcher.getByRole('link', { name: 'Biller', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Counter tablet' })).toBeVisible()
}

/**
 * The counter at a Kalyani that has chosen no order settings.
 *
 * The demo's Kalyani bills with the owner's own settings — dine-in and
 * takeaway, keyed tables, ₹10 packaging — so every order there waits for a
 * service type. Most of this file is about something else, asserted against the
 * counter as it bills where nothing is chosen, so a test says so first, through
 * the owner's own Orders switch, as `billing-counter.test.tsx` does with its
 * `serving` option. The demo as shipped is walked by its own test.
 */
async function openCounterWithNothingChosen(page: Page, beforeSwitch?: () => Promise<void>) {
  await page.goto(`demo/owner/outlets/${KALYANI}`)
  const orders = page.getByTestId('service-orders-switch')
  await expect(orders).toHaveAttribute('aria-checked', 'true')
  await orders.click()
  await page.getByTestId('service-save').click()
  await expect(page.getByTestId('service-save')).toBeHidden()
  await beforeSwitch?.()
  await switchToBiller(page)
}

test('the counter lands on the enrolled tablet itself, with a shift already open', async ({
  page,
}) => {
  // Pin time before the counter subscribes: its seeded payment sends after
  // 400ms, so host/browser load must not decide whether we observe the queue.
  const now = new Date()
  await page.clock.install({ time: new Date(now.getTime() - 60_000) })
  await openCounterWithNothingChosen(page, () => page.clock.pauseAt(now))
  // The demo mounts the same shell /counter mounts, at the tablet's one address.
  await expect(page).toHaveURL(/\/demo\/biller$/)
  await expect(page.getByRole('heading', { name: 'Counter tablet' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Hand over', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Finish day' })).toBeVisible()
  await expect(page.getByTestId('sync-indicator')).toHaveAttribute('data-sync', 'pending')
  await expect(page.getByTestId('sync-indicator')).toContainText('1 pending')
  await page.clock.runFor(500)
  await expect(page.getByTestId('sync-indicator')).toHaveAttribute('data-sync', 'synced')
})

test.describe('the counter', () => {
  test.beforeEach(async ({ page }) => {
    await openCounterWithNothingChosen(page)
  })

  for (const role of ['owner', 'admin']) {
    test(`${role} disables customer collection and the counter orders and pays without Skip`, async ({
      page,
    }) => {
      await page.goto(`demo/${role}/outlets/d0000000-0000-4000-a000-000000000001`)
      const control = page.getByRole('switch', { name: 'Collect customer details' })
      await expect(control).toHaveAttribute('aria-checked', 'true')
      await control.click()
      await page.getByTestId('service-save').click()
      await expect(page.getByTestId('service-save')).toBeHidden()
      await switchToBiller(page)
      await page.getByRole('button', { name: 'Classic Chicken Shawarma', exact: true }).click()
      // The page it came from keeps the outlet's own order settings, so the order
      // still waits for a service type; it no longer waits for a customer.
      await page.getByTestId('service-chip-takeaway').click()
      await expect(page.getByTestId('customer-row')).toHaveCount(0)
      await expect(page.getByTestId('save-order')).toBeEnabled()
      await page.getByTestId('save-order').click()
      const rail = page.getByTestId('counter-activity-rail')
      const queuedOrder = rail.getByTestId(/^open-order-local-/)
      await expect(queuedOrder).toBeVisible()
      const orderId = await queuedOrder.getAttribute('data-flip-id')
      expect(orderId).not.toBeNull()
      const order = rail.locator(`[data-flip-id="${orderId}"]`)
      await order.getByRole('button', { name: 'Paid', exact: true }).click()
      const payment = page.getByRole('dialog', { name: 'Record payment' })
      await expect(payment).toBeVisible()
      await expect(page.getByRole('dialog', { name: 'Receipt and points' })).toHaveCount(0)
      await expect(page.getByTestId('checkout-customer')).toHaveCount(0)
      await payment.getByRole('button', { name: 'Cash', exact: true }).click()
      await payment.getByRole('button', { name: 'Paid', exact: true }).click()
      await expect(order.getByRole('button', { name: 'Paid', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
    })
  }

  test('searches the menu, keeps the search through a tap, and clears it on Escape', async ({
    page,
  }) => {
    // The smallest tablet this is designed for.
    await page.setViewportSize({ width: 1024, height: 768 })
    const grid = page.getByTestId('menu-grid')
    const search = page.getByRole('textbox', { name: 'Search the menu' })
    const tiles = grid.locator('[data-testid^="tile-"]:not([data-testid^="tile-count-"])')
    await expect(tiles.first()).toBeVisible()
    const everything = await tiles.count()

    // Every word, any order, in the browser alone.
    // "chee chi" finds Cheese Chicken Shawarma and Chicken & Cheese Sandwich;
    // "shawarma" is the category's word, which narrows it to the one.
    await search.fill('chee chi')
    await expect(tiles).toHaveCount(2)
    await search.fill('cheese shawarma')
    await expect(tiles).toHaveCount(1)
    await expect(grid.getByRole('button', { name: 'Cheese Chicken Shawarma' })).toBeVisible()

    // A tap adds and leaves the search where it was.
    await grid.getByRole('button', { name: 'Cheese Chicken Shawarma' }).click()
    await expect(page.getByTestId('bill-total')).toHaveText('₹175')
    await expect(search).toHaveValue('cheese shawarma')
    await expect(tiles).toHaveCount(1)

    // Escape belongs to an open dialog first: it closes, the search stays.
    await page.getByTestId('customer-row').click()
    const customer = page.getByRole('dialog')
    await expect(customer).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(customer).toHaveCount(0)
    await expect(search).toHaveValue('cheese shawarma')

    // With nothing open, Escape clears it and drops the cursor.
    await page.keyboard.press('Escape')
    await expect(search).toHaveValue('')
    await expect(search).not.toBeFocused()
    await expect(tiles).toHaveCount(everything)

    // Nothing matching says so; the × clears it the same way.
    await search.fill('pizza')
    await expect(page.getByTestId('menu-search-empty')).toHaveText('No item matches “pizza”.')
    await page.getByRole('button', { name: 'Clear search' }).click()
    await expect(search).toHaveValue('')
    await expect(search).not.toBeFocused()
    await expect(tiles).toHaveCount(everything)
  })

  test('keeps the menu search in reach while a long menu scrolls under it', async ({ page }) => {
    // The smallest tablet this is designed for, and the real sixty-item menu,
    // which no counter column holds at once.
    await page.setViewportSize({ width: 1024, height: 768 })
    const grid = page.getByTestId('menu-grid')
    const column = grid.locator('xpath=..')
    const search = page.getByRole('textbox', { name: 'Search the menu' })
    await expect(grid.getByRole('button', { name: 'Fresh Lime Soda' })).toBeAttached()

    expect(await column.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true)
    await column.evaluate((node) => node.scrollTo({ top: node.scrollHeight }))
    await expect(grid.getByRole('button', { name: 'Fresh Lime Soda' })).toBeInViewport()

    const columnBox = (await column.boundingBox())!
    const searchBox = (await search.boundingBox())!
    expect(searchBox.y).toBeGreaterThanOrEqual(columnBox.y)
    expect(searchBox.y + searchBox.height).toBeLessThanOrEqual(columnBox.y + columnBox.height)

    // And it still works from down there.
    await search.fill('nashville wings')
    await expect(grid.getByRole('button', { name: 'Nashville Chicken Wings' })).toBeInViewport()
  })

  test('identifies at payment and keeps the number when checkout is reopened', async ({ page }) => {
    await page.getByRole('button', { name: 'Classic Chicken Shawarma', exact: true }).click()
    await page.getByTestId('settle').click()
    let question = page.getByRole('dialog', { name: 'Receipt and points' })
    await expect(question.getByRole('heading', { name: 'Receipt and points' })).toBeFocused()
    await expect(page.getByRole('dialog', { name: 'Record payment' })).toHaveCount(0)
    await question.getByTestId('customer-dismiss').click()
    await expect(page.getByTestId('bill-total')).toHaveText('₹135')
    await expect(page.getByTestId('customer-row')).toHaveText('Enter Customer Info')
    await page.getByTestId('settle').click()
    question = page.getByRole('dialog', { name: 'Receipt and points' })
    for (const digit of '9000000101')
      await question.getByRole('button', { name: digit, exact: true }).click()
    await question.getByTestId('customer-confirm').click()
    const payment = page.getByRole('dialog', { name: 'Record payment' })
    await expect(payment.getByTestId('checkout-customer')).toContainText('Ritika Sen')
    await expect(payment.getByRole('img', { name: 'Gold member' })).toBeVisible()
    await expect(payment.getByText('Total to pay')).toBeVisible()
    await payment.getByRole('button', { name: 'Back', exact: true }).click()
    await page.getByTestId('settle').click()
    await expect(question).toHaveCount(0)
    await expect(payment.getByTestId('checkout-customer')).toContainText('Ritika Sen')
  })

  test('keeps optional ordering identification and allows Paid to ask for the number first', async ({
    page,
  }) => {
    await page.getByRole('button', { name: 'Classic Chicken Shawarma', exact: true }).click()
    await expect(page.getByTestId('customer-row')).toHaveText('Enter Customer Info')
    await expect(page.getByRole('button', { name: 'Order', exact: true })).toBeEnabled()
    await expect(page.getByTestId('settle')).toBeEnabled()
    await expect(page.getByTestId('settle')).toHaveText('Paid')
    // Ordering needs no customer decision; payment remains the checkpoint.
    await expect(page.getByText(/Add a customer/i)).toHaveCount(0)

    // A number nobody has used before, so the UI insists on a name for it.
    await identifyCustomer(page, '9000000000', 'Rahul')
    await expect(page.getByTestId('customer-row')).toContainText('Rahul · +91 90000 00000')
    await expect(page.getByRole('button', { name: 'Order', exact: true })).toBeEnabled()
    await expect(page.getByTestId('settle')).toBeEnabled()

    // A decision is revised by making a different one: the row reopens the
    // dialog, and there is no clear action beside it.
    await expect(page.getByTestId('clear-customer')).toHaveCount(0)

    // Skipping is a decision too, and it costs opening the dialog first. There
    // is no skip on the composer — that is the one control this change most
    // deliberately does not add.
    await expect(page.getByTestId('skip-customer')).toHaveCount(0)
    await skipCustomer(page)
    await expect(page.getByRole('dialog', { name: 'Customer' })).toHaveCount(0)
    await expect(page.getByTestId('customer-row')).toHaveText('Skipped Customer Info')
    await expect(page.getByRole('button', { name: 'Order', exact: true })).toBeEnabled()
    await expect(page.getByTestId('save-order')).toHaveClass(/bg-primary/)
    await expect(page.getByTestId('settle')).toHaveClass(/bg-surface/)
  })

  test('keeps the bill until payment allocations exactly cover it', async ({ page }) => {
    await page.getByRole('button', { name: 'Classic Chicken Shawarma', exact: true }).click()
    await skipCustomer(page)
    await page.getByTestId('settle').click()

    await skipPaymentCustomerIfAsked(page)

    const dialog = page.getByRole('dialog', { name: 'Record payment' })
    await expect(dialog.getByRole('heading', { name: 'Record payment' })).toBeFocused()
    const cashClass = await dialog
      .getByRole('button', { name: 'Cash', exact: true })
      .getAttribute('class')
    await expect(dialog.getByRole('button', { name: 'UPI', exact: true })).toHaveAttribute(
      'class',
      cashClass!,
    )
    await expect(dialog.getByRole('button', { name: 'Paid', exact: true })).toBeDisabled()
    await expect(page.getByTestId('bill-total')).toHaveText('₹135')
    await expect(page.getByTestId('settled-confirmation')).toHaveCount(0)
  })

  test('will not sell an unavailable item', async ({ page }) => {
    const off = page.getByRole('button', {
      name: 'Lebanese Chicken Shawarma — unavailable',
    })
    await expect(off).toBeVisible()
    await expect(off).toBeDisabled()
  })

  test('edits an immediate payment beside the paid bill', async ({ page }) => {
    await page.getByRole('button', { name: 'Mayonnaise Chicken Shawarma' }).click()
    await skipCustomer(page)
    await recordPaid(page)

    await expect(page.getByTestId('undo-settle')).toHaveCount(0)
    const paidBill = page.locator('details').filter({
      has: page.locator('summary').filter({ hasText: 'Cash' }).filter({ hasText: '₹155' }),
    })
    await paidBill.locator('summary').click()
    await paidBill.getByRole('button', { name: /^Edit \(\d+ min\)$/ }).click()
    await skipPaymentCustomerIfAsked(page)
    const edit = page.getByRole('dialog', { name: 'Record payment' })
    await expect(edit.getByRole('heading', { name: 'Edit payment' })).toBeVisible()
    await edit.getByRole('button', { name: 'Remove Cash payment' }).click()
    await edit.getByRole('button', { name: 'UPI', exact: true }).click()
    await edit.getByRole('button', { name: 'Save payment' }).click()
    await expect(page.getByText('Payment updated.')).toBeVisible()

    const correctedBill = page.locator('details').filter({
      has: page.locator('summary').filter({ hasText: 'UPI' }).filter({ hasText: '₹155' }),
    })
    if ((await correctedBill.getAttribute('open')) === null) {
      await correctedBill.locator('summary').click()
    }
    await correctedBill.getByRole('button', { name: 'Demo: 59 sec' }).click()
    await expect(correctedBill.getByRole('button', { name: /^Edit \(5\d sec\)$/ })).toBeVisible()
    await correctedBill.getByRole('button', { name: 'Demo: expire' }).click()
    await expect(correctedBill.getByRole('button', { name: /^Edit \(/ })).toHaveCount(0)

    // Long settled: the composer never came back after the payment.
    await expect(page.getByRole('heading', { name: 'Bills this shift' })).toBeVisible()
    await expect(page.getByTestId('bill-total')).toHaveCount(0)
  })

  test('draws the pipeline newest first, whatever order the adapter answers in', async ({
    page,
  }) => {
    // The rail promises newest-first and enforces it itself: the live adapter
    // orders `ordered_at` descending and the mock did not, so demo mode drew the
    // rail upside down until #55 made the surface responsible for its own claim.
    const list = page.getByTestId('counter-activity-rail').getByTestId('pipeline-list')

    await page.getByRole('button', { name: 'Classic Chicken Shawarma', exact: true }).click()
    const newest = await saveNewOrder(page)

    const cards = list.locator(':scope > li')
    expect(await cards.count()).toBeGreaterThan(1)
    // The order just taken is the first card, which is the whole reason the
    // list reads this way: a correction happens in the seconds after saving.
    await expect(cards.first().locator(`[data-flip-id="${newest}"]`)).toHaveCount(1)
  })

  test('leaves an upfront payment reversible while the food is still being made', async ({
    page,
  }) => {
    const rail = page.getByTestId('counter-activity-rail')
    const list = rail.getByTestId('pipeline-list')
    // 105 is the seed whose preparation is not recorded.
    const order = list.getByTestId('open-order-105')

    await order.getByRole('button', { name: 'Paid', exact: true }).click()
    await skipPaymentCustomerIfAsked(page)
    const payment = page.getByRole('dialog', { name: 'Record payment' })
    await payment.getByRole('button', { name: 'Cash', exact: true }).click()
    await payment.getByRole('button', { name: 'Paid', exact: true }).click()
    await expect(page.locator('dialog[open]')).toHaveCount(0)

    // The ticket is not finished, so its payment has no deadline: the ticked
    // Paid box unticks through the reasoned take-back rather than refusing, and
    // it will still do so in an hour.
    const paidCard = list.getByTestId('open-order-105')
    const paid = paidCard.getByRole('button', { name: 'Paid', exact: true })
    await expect(paid).toHaveAttribute('aria-pressed', 'true')
    await paid.click()
    const takeBack = page.getByRole('dialog', { name: /^Take back the payment for/ })
    await expect(takeBack.getByRole('heading', { name: 'Take this payment back?' })).toBeVisible()
    await takeBack.getByPlaceholder('Why is this payment coming back?').fill('Wrong tender')
    await takeBack.getByRole('button', { name: 'Take it back' }).click()

    // Back in the pipeline, in the same place, ready to be paid again.
    await expect(
      list.getByTestId('open-order-105').getByRole('button', { name: 'Paid', exact: true }),
    ).toHaveAttribute('aria-pressed', 'false')
  })

  test('resolves a complete number and says nothing at all before the tenth digit', async ({
    page,
  }) => {
    // The customer row lives in the composer, which opens on the first tap.
    await page.getByRole('button', { name: 'Classic Chicken Shawarma', exact: true }).click()
    await page.getByTestId('customer-row').click()
    const dialog = page.getByRole('dialog', { name: 'Customer' })

    for (const digit of '900000010') {
      await dialog.getByRole('button', { name: digit, exact: true }).click()
    }
    // Nine digits of a number this outlet HAS served, so what shows is the
    // outlet-scoped suggestion rather than an answer from the directory.
    await expect(dialog.getByTestId('customer-suggestion')).toContainText('Ritika Sen')
    await expect(dialog.getByTestId('customer-confirm')).toBeDisabled()

    await dialog.getByRole('button', { name: '1', exact: true }).click()
    await expect(dialog.getByTestId('customer-match')).toContainText('Ritika Sen')
    await expect(dialog.getByTestId('customer-match')).toContainText('+91 90000 00101')
    await expect(dialog.getByTestId('customer-suggestion')).toHaveCount(0)
    await dialog.getByTestId('customer-confirm').click()
    await expect(page.getByTestId('customer-row')).toContainText('Ritika Sen · +91 90000 00101')
  })

  test('cancels a compact open order with a one-tap reason and confirmation', async ({ page }) => {
    const rail = page.getByTestId('counter-activity-rail')
    const order = rail.getByTestId('open-order-104')
    await expect(order.getByRole('button', { name: /^More actions for Order .104$/ })).toBeVisible()
    await order.getByRole('button', { name: /^More actions for Order .104$/ }).click()
    await order.getByRole('menuitem', { name: 'Cancel order' }).click()

    const dialog = page.getByRole('dialog', { name: 'Cancel order 104' })
    const reason = dialog.getByRole('textbox', { name: 'Cancellation reason' })
    await expect(reason).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Other reason' })).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Duplicate order' }).click()
    await expect(reason).toHaveValue('Duplicate order')
    await reason.fill('Duplicate — customer confirmed')
    await dialog.getByRole('button', { name: 'Confirm cancel' }).click()
    // No confirmation bar: the card leaving the rail is the acknowledgement.
    await expect(rail.getByText('Order 104', { exact: true })).toHaveCount(0)
  })

  test('removes unsupported methods and keeps dedicated activity routes on narrower screens', async ({
    page,
  }) => {
    await page.getByRole('button', { name: 'Classic Chicken Shawarma', exact: true }).click()
    await skipCustomer(page)
    await page.getByTestId('settle').click()
    await skipPaymentCustomerIfAsked(page)
    const payment = page.getByRole('dialog', { name: 'Record payment' })
    for (const unsupported of ['Swiggy', 'Zomato', 'Card', 'Other']) {
      await expect(payment.getByRole('button', { name: unsupported })).toHaveCount(0)
    }
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('counter-activity-rail')).toBeVisible()
  })

  test('needs no device keyboard to enter a customer phone', async ({ page }) => {
    await page.getByRole('button', { name: 'Classic Chicken Shawarma', exact: true }).click()
    await page.getByTestId('customer-row').click()
    const dialog = page.getByRole('dialog', { name: 'Customer' })

    // Every digit comes from the dialog's own pad, so there is no text input to
    // ask the device for a numeric keyboard in the first place.
    for (const key of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '00']) {
      await expect(dialog.getByRole('button', { name: key, exact: true })).toBeVisible()
    }
    await expect(dialog.getByRole('button', { name: 'Delete last digit' })).toBeVisible()
    for (const digit of '9000000101') {
      await dialog.getByRole('button', { name: digit, exact: true }).click()
    }
    await expect(dialog.getByTestId('customer-phone-readout')).toHaveText('+91 90000 00101')
  })

  test('suggests one customer this outlet has served, and counts the rest', async ({ page }) => {
    await page.getByRole('button', { name: 'Classic Chicken Shawarma', exact: true }).click()
    await page.getByTestId('customer-row').click()
    const dialog = page.getByRole('dialog', { name: 'Customer' })

    // Below four digits nothing is shown and nobody is asked.
    for (const digit of '900') {
      await dialog.getByRole('button', { name: digit, exact: true }).click()
    }
    await expect(dialog.getByTestId('customer-resolution')).toBeEmpty()

    await dialog.getByRole('button', { name: '0', exact: true }).click()
    // One match and a count of the others. Never a list: a list over the
    // customer directory is the path this product does not have.
    await expect(dialog.getByTestId('customer-suggestion')).toHaveCount(1)
    await expect(dialog.getByTestId('customer-suggestion')).toContainText('Ritika Sen')
    // She is a gold member, and the suggestion says so before it is taken.
    await expect(
      dialog.getByTestId('customer-suggestion').getByRole('img', { name: 'Gold member' }),
    ).toBeVisible()
    // Every demo customer's number opens `9000`, so the rest are counted.
    await expect(dialog.getByTestId('customer-suggestion-others')).toHaveText('+6 more')

    // The digits still to be checked are the ones drawn strongly.
    await expect(dialog.getByTestId('customer-suggestion').getByText('0 00101')).toHaveClass(
      /font-bold/,
    )
  })

  test('removes the legacy PIN shift surface now that the enrolled tablet owns handover', async ({
    page,
  }) => {
    await expect(page.getByRole('link', { name: 'Shift', exact: true })).toHaveCount(0)

    await page.goto('demo/biller/shift')
    await expect(page.getByRole('heading', { name: 'That page does not exist' })).toBeVisible()
    await expect(page.getByLabel(/PIN/i)).toHaveCount(0)
  })

  test('is a leaf: the tablet has one address and no sub-pages', async ({ page }) => {
    // Production mounts `/counter` as a leaf route, so nothing lives beneath it
    // there either — the tablet's surfaces are panels within one shell, not
    // addresses. A path a Biller has no entry for still gets the honest answer.
    for (const path of ['demo/biller/billing', 'demo/biller/my-shift', 'demo/biller/team']) {
      await page.goto(path)
      await expect(page.getByRole('heading', { name: 'That page does not exist' })).toBeVisible()
      // Still unmistakably a demo while saying so.
      await expect(page.getByTestId('demo-banner')).toBeVisible()
    }
  })

  test('explains what is blocking Finish day instead of refusing opaquely', async ({ page }) => {
    await page.getByRole('button', { name: 'Finish day' }).click()

    // The sheet drains first, then names every hard blocker with the action that
    // clears it. The demo scenario carries two.
    const readiness = page.getByTestId('finish-day-readiness')
    await expect(readiness).toContainText('needs attention')
    await expect(readiness).toContainText('open orders')
    await expect(readiness).toContainText('correct or discard it with a reason')

    // And it never strands the operator: billing is one tap away again.
    await page.getByRole('button', { name: 'Keep billing' }).click()
    await expect(readiness).toHaveCount(0)
  })

  test('keeps the shift totals pinned while the bills beneath them scroll', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 })
    const totals = page.getByTestId('shift-total-cash')
    await expect(totals).toBeVisible()

    const before = await totals.boundingBox()
    const scrolled = await page.evaluate(() => {
      const section = document.querySelector('section[aria-labelledby="my-shift-title"]')!
      const body = [...section.children].find((child) =>
        child.className.includes('overflow-y-auto'),
      ) as HTMLElement
      const scrollable = body.scrollHeight > body.clientHeight
      body.scrollTop = body.scrollHeight
      return { scrollable, scrollTop: body.scrollTop }
    })

    // The column scrolls rather than running its last bills off the screen.
    expect(scrolled.scrollable).toBe(true)
    expect(scrolled.scrollTop).toBeGreaterThan(0)

    // The day's takings do not move with it: a total you have to scroll back for
    // is a total you check less often, with a queue in front of you.
    expect((await totals.boundingBox())?.y).toBe(before?.y)
  })
})

/**
 * The number pads from a physical keyboard (keypads-take-a-physical-keyboard):
 * a counter billing from a laptop, or a tablet with a keyboard attached, types
 * on every pad exactly as it taps. Every pad here is driven by `page.keyboard`
 * alone, and opens with focus on its heading and no text field anywhere, so a
 * touch screen has nothing to raise its own keyboard for.
 */
test.describe('the counter from a physical keyboard', () => {
  /** The pad opened with nothing that would raise a device keyboard. */
  async function expectNoTextFocus(page: Page) {
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('H2')
  }

  test('types the customer number, points and a discount, and Enter confirms each', async ({
    page,
  }) => {
    await openCounterWithNothingChosen(page)
    await page.getByRole('button', { name: 'Classic Chicken Shawarma', exact: true }).click()
    await expect(page.getByTestId('bill-total')).toHaveText('₹135')

    await page.getByTestId('customer-row').click()
    const customer = page.getByRole('dialog', { name: 'Customer' })
    await expect(customer.getByRole('heading', { name: 'Customer' })).toBeFocused()
    await expectNoTextFocus(page)
    // Top row, then the number pad with Num Lock off, which arrives as
    // navigation keys and is read by position.
    await page.keyboard.type('90000001')
    await page.keyboard.press('Numpad0')
    await page.keyboard.press('Numpad9')
    await page.keyboard.press('Backspace')
    await page.keyboard.press('Numpad1')
    await expect(customer.getByTestId('customer-phone-readout')).toHaveText('+91 90000 00101')
    await expect(customer.getByTestId('customer-match')).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(customer).toHaveCount(0)

    await page.getByTestId('use-points').click()
    const points = page.getByRole('dialog', { name: 'Use points' })
    await expect(points.getByRole('heading', { name: 'Use points' })).toBeFocused()
    await expectNoTextFocus(page)
    await page.keyboard.press('Backspace')
    await page.keyboard.press('Backspace')
    await page.keyboard.type('5')
    await expect(points.getByTestId('points-readout')).toContainText('5')
    await page.keyboard.press('Enter')
    await expect(points).toHaveCount(0)
    await expect(page.getByTestId('bill-total')).toHaveText('₹130')

    await page.getByTestId('add-discount').click()
    const discount = page.getByRole('dialog', { name: 'Add discount' })
    await expect(discount.getByRole('heading', { name: 'Add discount' })).toBeFocused()
    await expectNoTextFocus(page)
    // Two decimal places is the pad's own limit, and typing keeps it.
    await page.keyboard.type('12.555')
    await expect(discount.getByTestId('discount-readout')).toHaveText('Discount12.55%')
    await page.keyboard.press('Backspace')
    await expect(discount.getByTestId('discount-readout')).toHaveText('Discount12.5%')
    await page.keyboard.press('Enter')
    await expect(discount).toHaveCount(0)
    await expect(page.getByTestId('bill-discount-rows')).toContainText('12.5%')
  })

  test('keys a table, and a control reached with Tab keeps its own Enter', async ({ page }) => {
    // The demo as shipped: Kalyani seats keyed tables.
    await page.goto('demo/biller')

    await page.getByRole('button', { name: 'Classic Chicken Shawarma', exact: true }).click()
    await page.getByTestId('service-chip-dine_in').click()
    const tables = page.getByRole('dialog', { name: 'Which table' })
    await expect(tables.getByRole('heading', { name: 'Which table?' })).toBeFocused()
    await expectNoTextFocus(page)
    // No leading nought, and three digits at most: the pad's rules, typed.
    await page.keyboard.type('01234')
    await expect(tables.getByTestId('table-readout')).toHaveText('Table 123')
    await page.keyboard.press('Backspace')
    await page.keyboard.press('Backspace')
    await expect(tables.getByTestId('table-readout')).toHaveText('Table 1')
    await page.keyboard.press('Enter')
    await expect(tables).toHaveCount(0)
    await expect(page.getByTestId('service-chip-dine_in')).toHaveText('Table 1')

    // Tab to No table: Enter there is that button's, not the pad's Done.
    await page.getByTestId('service-chip-dine_in').click()
    await expect(tables.getByRole('heading', { name: 'Which table?' })).toBeFocused()
    await page.keyboard.type('7')
    for (let step = 0; step < 30; step += 1) {
      await page.keyboard.press('Tab')
      if (
        await tables.getByTestId('table-none').evaluate((node) => node === document.activeElement)
      )
        break
    }
    await expect(tables.getByTestId('table-none')).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(tables).toHaveCount(0)
    await expect(page.getByTestId('service-chip-dine_in')).toHaveText('No table')
  })
})

test.describe('the demo’s Kalyani, billing as the shop does', () => {})

/**
 * The demo's connectivity, which lives in the yellow indicator rather than in a
 * strip of its own. Selecting by value, so a label rewording does not silently
 * stop exercising the state it names.
 */
async function setConnectivity(
  page: Page,
  state: 'online' | 'network-dropped' | 'closed-and-reopened',
) {
  await page.getByLabel('Demo connectivity').selectOption(state)
}

test.describe('the counter offline', () => {
  test('walks cold-start provenance, capture, Finish Day refusal and reconnect', async ({
    page,
  }) => {
    await openCounterWithNothingChosen(page)
    await setConnectivity(page, 'closed-and-reopened')

    await expect(page.getByTestId('offline-resume-status')).toContainText(
      'Offline · last successful read',
    )
    await expect(page.getByTestId('menu-as-of')).toBeVisible()
    await expect(page.getByTestId('pipeline-as-of')).toBeVisible()
    await expect(page.getByTestId('bills-as-of')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Hand over', exact: true })).toBeDisabled()

    await page.getByRole('button', { name: 'Classic Chicken Shawarma', exact: true }).click()
    await recordPaid(page)
    await expect(page.getByRole('heading', { name: 'Bills this shift' })).toBeVisible()

    await page.getByRole('button', { name: 'Finish day' }).click()
    const finishDialog = page.getByRole('dialog', { name: 'Finish day' })
    await expect(finishDialog.getByText('Finish Day is unavailable offline')).toBeVisible()
    await expect(finishDialog.getByRole('button', { name: 'Keep billing' })).toBeVisible()
    await expect(finishDialog.getByRole('button', { name: /finish day/i })).toHaveCount(0)
    await finishDialog.getByRole('button', { name: 'Keep billing' }).click()

    await setConnectivity(page, 'online')
    await expect(page.getByTestId('offline-resume-status')).toHaveCount(0)
    await expect(page.getByTestId('sync-indicator')).toHaveAttribute('data-sync', 'synced', {
      timeout: 15_000,
    })
  })

  test('accumulates, escalates, and drains when the connection returns', async ({
    page,
    context,
  }) => {
    const now = new Date()
    await page.clock.install({ time: new Date(now.getTime() - 60_000) })
    await openCounterWithNothingChosen(page, () => page.clock.pauseAt(now))
    await expect(page.getByTestId('sync-indicator')).toHaveAttribute('data-sync', 'pending')

    await context.setOffline(true)
    // Hold the seeded bill until offline is established, then restore normal
    // timers so the queued payments and reconnect exercise the real send path.
    await page.clock.resume()

    // Five bills is the escalation threshold from src/domain/billing.ts.
    for (let index = 0; index < 5; index += 1) {
      await page.getByRole('button', { name: 'Classic Chicken Shawarma', exact: true }).click()
      await recordPaid(page)
      // Cleared for the next customer even offline: durable locally, not sent.
      // No confirmation bar — the queued bill in the money list is the signal.
      await expect(page.getByRole('heading', { name: 'Bills this shift' })).toBeVisible()
      await expect(page.getByTestId('settled-confirmation')).toHaveCount(0)
    }

    await expect(page.getByTestId('sync-indicator')).toHaveAttribute('data-sync', 'stalled')
    await expect(page.getByTestId('sync-indicator')).toContainText('6 waiting')
    // Never a dialog, at any state.
    await expect(page.locator('dialog[open]')).toHaveCount(0)

    await context.setOffline(false)
    await expect(page.getByTestId('sync-indicator')).toHaveAttribute('data-sync', 'synced', {
      timeout: 15_000,
    })
    await expect(page.getByTestId('sync-indicator')).toContainText('synced')
  })

  /**
   * The same scene, reached the way a demonstrator reaches it.
   *
   * The case above drops the *browser's* network, which is the honest test of
   * the counter and needs no demo control at all. It is also invisible to
   * anybody being shown this app, because nobody opens devtools mid-pitch. This
   * one drives the indicator's own control, and asserts the thing that makes
   * the two paths safe to have: they arrive at one delivery path, so the queue
   * drains exactly once.
   */
  test('the demonstrator can drop the network from the indicator and bring it back', async ({
    page,
  }) => {
    const now = new Date()
    await page.clock.install({ time: new Date(now.getTime() - 60_000) })
    await openCounterWithNothingChosen(page, () => page.clock.pauseAt(now))
    await expect(page.getByTestId('sync-indicator')).toHaveAttribute('data-sync', 'pending')

    await setConnectivity(page, 'network-dropped')
    await page.clock.resume()

    // Still open, still taking money — and not resuming from a stored record,
    // which is what separates this scene from the cold start above.
    await expect(page.getByTestId('offline-resume-status')).toHaveCount(0)
    await expect(page.getByTestId('menu-grid')).toBeVisible()

    for (let index = 0; index < 5; index += 1) {
      await page.getByRole('button', { name: 'Classic Chicken Shawarma', exact: true }).click()
      await recordPaid(page)
      await expect(page.getByRole('heading', { name: 'Bills this shift' })).toBeVisible()
    }

    await expect(page.getByTestId('sync-indicator')).toHaveAttribute('data-sync', 'stalled')
    await expect(page.getByTestId('sync-indicator')).toContainText('6 waiting')
    await expect(page.locator('dialog[open]')).toHaveCount(0)

    const billRows = page.locator('details[data-testid^="shift-bill-"]')
    const billsBefore = await billRows.count()

    await setConnectivity(page, 'online')
    await expect(page.getByTestId('sync-indicator')).toHaveAttribute('data-sync', 'synced', {
      timeout: 15_000,
    })

    // Exactly once: the six that were waiting landed, and nothing was
    // duplicated by having two ways to reconnect.
    await expect(billRows).toHaveCount(billsBefore)
  })
})

test.describe('the demo indicator on the counter', () => {
  /**
   * The complaint this is here for: the role tabs must not move because the
   * connectivity control came or went.
   *
   * Measured **relative to the strip's own right edge**, not as an absolute `x`,
   * and the difference matters. Two separate things move these tabs. This change
   * fixed one of them — the control used to sit after the switcher, so arriving
   * at the counter widened everything to its right. The other is the page
   * scrollbar: the counter's page scrolls where a phone role's does not, so on
   * Windows and Linux the whole strip is 15px narrower here, tabs included.
   *
   * That second one is unfixed on purpose. `scrollbar-gutter: stable` cures it
   * and was reverted the same day for charging 15px of permanently empty gutter
   * on every screen including the till — see
   * `openspec/todos/the-document-should-not-be-what-scrolls.md`. So an absolute
   * assertion here would fail for a reason this change is not about, and would
   * have to be loosened by whoever hit it. An offset says the thing that is
   * actually true and stays true either way.
   */
  test('the role tabs do not move when the walkthrough switches role', async ({ page }) => {
    const positions = async () =>
      page.evaluate(async () => {
        // Await the web font before measuring. These offsets are decided by the
        // rendered width of the controls to the switcher's right, so a snapshot
        // taken before the font swaps reports the fallback's metrics and lands a
        // few pixels out — which is a measurement artefact and not the tabs
        // moving.
        await document.fonts.ready
        const stripRight = document
          .querySelector('[data-testid="demo-banner"]')!
          .getBoundingClientRect().right
        return [...document.querySelectorAll('[aria-label="Demo role switcher"] a')].map(
          (tab) =>
            `${tab.textContent}@${Math.round(stripRight - tab.getBoundingClientRect().right)}`,
        )
      })

    await openCounterWithNothingChosen(page)
    await expect(page.getByTestId('demo-connectivity')).toBeVisible()
    // The four roles, and the kitchen tablet beside them while its part gate
    // shows it (#70).
    const kitchens = isRenderable(getPartState('kitchen-tablets'), 'demo')
    const atCounter = await positions()
    expect(atCounter).toHaveLength(kitchens ? 5 : 4)

    // Every other surface, none of which offers a connectivity control.
    for (const segment of ['owner', 'admin', 'staff', ...(kitchens ? ['kitchen'] : [])]) {
      await page.getByRole('link', { name: new RegExp(`^${segment}$`, 'i') }).click()
      await expect(page.getByTestId('demo-connectivity')).toHaveCount(0)
      expect(await positions()).toEqual(atCounter)
    }

    // And back, with the control returning.
    await page.getByRole('link', { name: /^biller$/i }).click()
    await expect(page.getByTestId('demo-connectivity')).toBeVisible()
    expect(await positions()).toEqual(atCounter)
  })

  test('stays one row on a phone and on a tablet, and adds no second strip', async ({ page }) => {
    await openCounterWithNothingChosen(page)
    const banner = page.getByTestId('demo-banner')
    await expect(banner).toBeVisible()

    // The strip this control replaced. Asserted by its own words, because the
    // regression to guard against is somebody putting demo chrome back outside
    // the one container that marks chrome as chrome.
    await expect(page.getByText('Extended-outage walkthrough')).toHaveCount(0)

    for (const size of [
      { width: 375, height: 812 },
      { width: 1024, height: 768 },
    ]) {
      await page.setViewportSize(size)
      await expect(page.getByLabel('Demo connectivity')).toBeVisible()

      // One row: the strip is no taller than a single line of its own controls,
      // and the page does not scroll sideways to fit them.
      const height = (await banner.boundingBox())?.height ?? 0
      expect(height).toBeLessThanOrEqual(48)
      const overflows = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      )
      expect(overflows).toBe(false)

      // The right-hand cluster is anchored to the indicator's right edge, so
      // the role tabs, the reset and the exit hold one position whether or not
      // the connectivity control is present. Measured as an offset from the
      // banner rather than an absolute x, because the Biller's page scrolls and
      // the owner's does not — a scrollbar's width is a real 15px difference in
      // the whole strip's width and has nothing to do with this cluster.
      const clusterRight = await page.evaluate(() => {
        const strip = document.querySelector('[data-testid="demo-banner"]')!
        const cluster = strip.children[1]!
        return Math.round(
          strip.getBoundingClientRect().right - cluster.getBoundingClientRect().right,
        )
      })
      expect(clusterRight).toBeLessThanOrEqual(16)

      // The product starts immediately beneath the indicator rather than a row
      // further down. Measured to the shell's own first element — its device
      // header — because everything below that, the menu grid included, is the
      // counter's own layout and none of this change's business.
      const bannerBox = await banner.boundingBox()
      const headerBox = await page.getByRole('heading', { name: 'Counter tablet' }).boundingBox()
      const gap = headerBox!.y - (bannerBox!.y + bannerBox!.height)
      expect(gap).toBeGreaterThanOrEqual(0)
      expect(gap).toBeLessThan(40)
    }
  })
})

test.describe('the counter in both themes', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`renders in ${theme} with no console errors`, async ({ page }, testInfo) => {
      const errors: string[] = []
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text())
      })
      page.on('pageerror', (error) => errors.push(error.message))

      await page.goto('demo/biller')
      await setTheme(page, theme)
      await page.reload()

      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await expect(page.getByTestId('menu-grid')).toBeVisible()
      // The middle column's default is the money list; the composer is a mode.
      await expect(page.getByRole('heading', { name: 'Bills this shift' })).toBeVisible()

      await testInfo.attach(`counter-${theme}`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      })
      expect(errors).toEqual([])
    })
  }
})

test.describe('manager billing history', () => {})

test.describe('the rail as tickets, with the kitchen bell (#72)', () => {})
