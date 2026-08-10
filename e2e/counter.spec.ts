import { expect, test, type Page } from '@playwright/test'

/**
 * The counter, in a real browser, on the device it actually runs on.
 *
 * The gate for `ui-billing-counter` is three clauses and each has a test here:
 * a full order rung and settled on a tablet viewport, the whole menu visible
 * without scrolling, and the UI-only customer-name-or-phone gate.
 *
 * The offline spec is the other half — the sync indicator's three states are the
 * whole reason it exists, and the escalated one cannot be reached by looking at
 * a screenshot.
 *
 * baseURL carries the deployment sub-path, so every goto is relative.
 */

/** Matches `UNDO_WINDOW_MS` in src/domain/billing.ts, plus the mock's send latency. */
const AFTER_SEND_MS = 6_000 + 1_500

async function setTheme(page: Page, theme: 'light' | 'dark') {
  await page.evaluate((value) => {
    localStorage.setItem('shawarmania.theme', value)
  }, theme)
}

async function recordPaid(page: Page, method = 'Cash') {
  const name = page.getByPlaceholder('Customer name')
  const phone = page.getByPlaceholder('Phone number')
  if (!(await name.inputValue()).trim() && !(await phone.inputValue()).trim()) {
    await name.fill('Test customer')
  }
  await page.getByTestId('settle').click()
  const dialog = page.getByRole('dialog', { name: 'Record payment' })
  await dialog.getByRole('button', { name: method, exact: true }).click()
  await dialog.getByRole('button', { name: 'Mark Paid', exact: true }).click()
}

test.describe('the counter', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('demo/biller')
  })

  test('lands on the counter with a shift already open', async ({ page }) => {
    await expect(page).toHaveURL(/\/demo\/biller\/billing$/)
    await expect(page.getByTestId('shift-status')).toContainText('Demo Biller')
    await expect(page.getByTestId('sync-indicator')).toHaveAttribute('data-sync', 'pending')
    await expect(page.getByTestId('sync-indicator')).toContainText('1 pending')
  })

  test('shows the whole menu without scrolling on a tablet', async ({ page }) => {
    // The smallest tablet this is designed for. If a menu item is ever added
    // that pushes the grid past one screen, this fails rather than a shift does.
    await page.setViewportSize({ width: 1024, height: 768 })
    const grid = page.getByTestId('menu-grid')
    await expect(grid).toBeVisible()

    const fits = await grid.evaluate((node) => node.scrollHeight <= node.clientHeight)
    expect(fits).toBe(true)

    // And every item really is on it, including the one that is off today.
    await expect(grid.getByRole('button')).toHaveCount(7)
  })

  test('records a full bill through the tap-first payment dialog', async ({ page }) => {
    await page.getByRole('button', { name: 'Classic Chicken Shawarma', exact: true }).click()
    await page.getByRole('button', { name: 'Classic Chicken Shawarma', exact: true }).click()
    await page.getByRole('button', { name: 'Mozzarella Cheese Chicken Shawarma' }).click()
    await page.getByRole('button', { name: 'Fully Loaded Smashed Burger' }).click()

    // 139×2 + 199 + 250
    await expect(page.getByTestId('bill-total')).toHaveText('₹727')

    await recordPaid(page)

    // Cleared for the next customer, immediately.
    await expect(page.getByTestId('bill-total')).toHaveText('₹0')

    const confirmation = page.getByTestId('settled-confirmation')
    await expect(confirmation).toContainText('₹727')
    await expect(page.getByTestId('local-reference')).toHaveText(/^Local · [0-9A-Z]{4}$/)

    // It clears itself; nothing has to be acknowledged.
    await expect(confirmation).toBeHidden({ timeout: AFTER_SEND_MS })
  })

  test('requires either customer name or phone before Order or Mark Paid', async ({ page }) => {
    await page.getByRole('button', { name: 'Classic Chicken Shawarma', exact: true }).click()
    await expect(page.getByPlaceholder('Customer name')).toHaveValue('')
    await expect(page.getByPlaceholder('Phone number')).toHaveValue('')
    await expect(page.getByRole('button', { name: 'Order', exact: true })).toBeDisabled()
    await expect(page.getByTestId('settle')).toBeDisabled()
    await expect(page.getByTestId('settle')).toHaveText('Mark Paid')
    await expect(page.getByText('Add a customer name or phone to continue.')).toBeVisible()

    await page.getByPlaceholder('Phone number').fill('9000000000')
    await expect(page.getByRole('button', { name: 'Order', exact: true })).toBeEnabled()
    await expect(page.getByTestId('settle')).toBeEnabled()
    await expect(page.getByTestId('save-order')).toHaveClass(/bg-primary/)
    await expect(page.getByTestId('settle')).toHaveClass(/bg-surface/)
  })

  test('keeps the bill until payment allocations exactly cover it', async ({ page }) => {
    await page.getByRole('button', { name: 'Classic Chicken Shawarma', exact: true }).click()
    await page.getByPlaceholder('Customer name').fill('Demo Regular')
    await page.getByTestId('settle').click()

    const dialog = page.getByRole('dialog', { name: 'Record payment' })
    await expect(dialog.getByRole('button', { name: 'Mark Paid', exact: true })).toBeDisabled()
    await expect(page.getByTestId('bill-total')).toHaveText('₹139')
    await expect(page.getByTestId('settled-confirmation')).toBeHidden()
  })

  test('will not sell an item that is off the menu', async ({ page }) => {
    const off = page.getByRole('button', {
      name: 'Stuffed Lebanese Chicken Shawarma — off the menu',
    })
    await expect(off).toBeVisible()
    await expect(off).toBeDisabled()
  })

  test('undoes a settle and puts the order back', async ({ page }) => {
    await page.getByRole('button', { name: 'Mayonnaise Chicken Shawarma' }).click()
    await page.getByPlaceholder('Customer name').fill('Demo Regular')
    await recordPaid(page)

    await page.getByTestId('undo-settle').click()

    await expect(page.getByTestId('bill-total')).toHaveText('₹159')
    await expect(page.getByPlaceholder('Customer name')).toHaveValue('Demo Regular')
    await expect(page.getByTestId('settled-confirmation')).toBeHidden()
  })

  test('saves and records a food-first order from the persistent rail', async ({ page }) => {
    await page.getByRole('button', { name: 'Classic Chicken Shawarma', exact: true }).click()
    await page.getByRole('button', { name: 'Mayonnaise Chicken Shawarma', exact: true }).click()
    await page.getByPlaceholder('Customer name').fill('Asha')
    await page.getByTestId('save-order').click()
    await expect(page.getByTestId('saved-order-confirmation')).toHaveCount(0)

    const rail = page.getByTestId('counter-activity-rail')
    await expect(rail.getByRole('heading', { name: 'Open orders' })).toBeVisible()
    const saved = rail.getByTestId('open-order-105')
    await expect(saved.getByText('Asha', { exact: true })).toBeVisible()
    await expect(saved.getByText('Classic Chicken Shawarma', { exact: true })).toBeVisible()
    await expect(saved.getByText('Mayonnaise Chicken Shawarma', { exact: true })).toBeVisible()
    await expect(saved.getByText('Order #105', { exact: true })).toBeVisible()
    await expect(saved.getByText('now', { exact: true })).toBeVisible()
    await expect(saved.getByText('Demo Biller', { exact: true })).toHaveCount(0)
    await expect(
      saved.getByText('Classic Chicken Shawarma', { exact: true }).locator('..'),
    ).toContainText('₹139')
    await expect(
      saved.getByText('Mayonnaise Chicken Shawarma', { exact: true }).locator('..'),
    ).toContainText('₹159')
    await expect(saved).toContainText('₹298')
    await saved.getByRole('button', { name: 'Mark Paid', exact: true }).click()
    const payment = page.getByRole('dialog', { name: 'Record payment' })
    await payment.getByRole('button', { name: 'Swiggy', exact: true }).click()
    await payment.getByRole('button', { name: 'Mark Paid', exact: true }).click()
    await expect(page.getByText(/recorded as paid. Bill number assigned/)).toBeVisible()

    const closed = rail.locator('details').filter({ hasText: 'Swiggy' }).first()
    await expect(closed).toBeVisible()
    await closed.locator('summary').click()
    await expect(closed).toContainText('Classic Chicken Shawarma')
    await expect(closed).toContainText('Mayonnaise Chicken Shawarma')
    await expect(closed).toContainText('1 × ₹139')
  })

  test('edits an order in the full composer and restores the waiting draft', async ({ page }) => {
    await page.getByRole('button', { name: 'Classic Chicken Shawarma', exact: true }).click()
    await page.getByPlaceholder('Customer name').fill('Waiting customer')

    const rail = page.getByTestId('counter-activity-rail')
    const order = rail.getByTestId('open-order-104')
    await order.getByRole('button', { name: 'Edit order 104' }).click()
    await expect(page.getByRole('heading', { name: 'Editing order #104' })).toBeVisible()
    const classicQuantity = page
      .getByRole('button', { name: 'One more Classic Chicken Shawarma' })
      .locator('xpath=preceding-sibling::span[1]')
    await expect(classicQuantity).toHaveText('2')
    await expect(page.getByPlaceholder('Customer name')).toHaveValue('Demo Customer')

    await page.getByRole('button', { name: 'Mayonnaise Chicken Shawarma', exact: true }).click()
    await page.getByPlaceholder('Customer name').fill('Updated customer')
    await page.getByPlaceholder('Phone number').fill('9000000222')
    await page.getByTestId('save-order').click()

    await expect(page.getByRole('heading', { name: 'Current bill' })).toBeVisible()
    await expect(page.getByPlaceholder('Customer name')).toHaveValue('Waiting customer')
    await expect(classicQuantity).toHaveText('1')
    await expect(order.getByText('Updated customer', { exact: true })).toBeVisible()
    await expect(order.getByText('Mayonnaise Chicken Shawarma', { exact: true })).toBeVisible()

    await order.getByRole('button', { name: 'Edit order 104' }).click()
    await page.getByRole('button', { name: 'One more Classic Chicken Shawarma' }).click()
    await page.getByTestId('cancel-edit').click()
    await expect(page.getByPlaceholder('Customer name')).toHaveValue('Waiting customer')
    await expect(classicQuantity).toHaveText('1')
  })

  test('offers exact-phone autofill only after the complete number and keeps conflicts local', async ({
    page,
  }) => {
    await page.getByPlaceholder('Customer name').fill('Ria')
    await page.getByPlaceholder('Phone number').fill('900000010')
    await expect(page.getByTestId('customer-match')).toHaveCount(0)
    await page.getByPlaceholder('Phone number').fill('9000000101')
    await expect(page.getByTestId('customer-match')).toContainText(
      'replaces the name in this order only',
    )
    await page.getByRole('button', { name: 'Keep this order' }).click()
    await expect(page.getByPlaceholder('Customer name')).toHaveValue('Ria')
  })

  test('records a mixed cash and UPI payment in exact paise', async ({ page }) => {
    await page.getByRole('button', { name: 'Classic Chicken Shawarma', exact: true }).click()
    await page.getByPlaceholder('Customer name').fill('Demo Regular')
    await page.getByTestId('settle').click()
    const dialog = page.getByRole('dialog', { name: 'Record payment' })
    for (const digit of ['1', '0', '0']) {
      await dialog.getByRole('button', { name: digit, exact: true }).click()
    }
    await dialog.getByRole('button', { name: 'Cash', exact: true }).click()
    await expect(dialog.getByRole('list', { name: 'Payment split' })).toContainText('₹100')
    await dialog.getByRole('button', { name: 'UPI', exact: true }).click()
    await expect(dialog.getByRole('list', { name: 'Payment split' })).toContainText('₹39')
    await dialog.getByRole('button', { name: 'Mark Paid', exact: true }).click()
    await expect(page.getByTestId('settled-confirmation')).toBeVisible()
  })

  test('cancels a compact open order with a one-tap reason and confirmation', async ({ page }) => {
    const rail = page.getByTestId('counter-activity-rail')
    const order = rail.getByTestId('open-order-104')
    await expect(order.getByRole('button', { name: 'Edit order 104' })).toBeVisible()
    await order.getByRole('button', { name: 'Cancel order 104' }).click()

    const dialog = page.getByRole('dialog', { name: 'Cancel order 104' })
    const reason = dialog.getByRole('textbox', { name: 'Cancellation reason' })
    await expect(reason).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Other reason' })).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Duplicate order' }).click()
    await expect(reason).toHaveValue('Duplicate order')
    await reason.fill('Duplicate — customer confirmed')
    await dialog.getByRole('button', { name: 'Confirm cancel' }).click()
    await expect(page.getByText('Order 104 cancelled.')).toBeVisible()
    await expect(rail.getByText('Order 104', { exact: true })).toHaveCount(0)
  })

  test('limits My shift and exposes originating-tablet correction', async ({ page }) => {
    const rail = page.getByTestId('counter-activity-rail')
    await expect(rail.getByRole('heading', { name: 'Bills this shift' })).toBeVisible()
    await expect(rail.getByTestId('shift-total-swiggy')).toContainText('₹0')
    await expect(rail.getByTestId('shift-total-zomato')).toContainText('₹318')
    await expect(rail.getByText('Payment needs attention')).toBeVisible()
    await rail.getByRole('button', { name: 'Correct with new copy' }).click()
    await expect(page.getByText(/linked correction was created/)).toBeVisible()
  })

  test('removes unsupported methods and keeps dedicated activity routes on narrower screens', async ({
    page,
  }) => {
    await page.getByRole('button', { name: 'Classic Chicken Shawarma', exact: true }).click()
    await page.getByPlaceholder('Customer name').fill('Demo Regular')
    await page.getByTestId('settle').click()
    await expect(
      page.getByRole('dialog', { name: 'Record payment' }).getByText('Card'),
    ).toHaveCount(0)
    await expect(
      page.getByRole('dialog', { name: 'Record payment' }).getByText('Other'),
    ).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('counter-activity-rail')).toBeVisible()

    await page.setViewportSize({ width: 820, height: 900 })
    await expect(page.getByTestId('counter-activity-rail')).toBeHidden()
    await page.getByRole('link', { name: 'Open orders' }).click()
    await expect(page.getByRole('heading', { name: 'Open orders' })).toBeVisible()
    await page.getByRole('link', { name: 'My shift' }).click()
    await expect(page.getByRole('heading', { name: 'My shift' })).toBeVisible()
  })

  test('requests the native numeric keypad for customer phone', async ({ page }) => {
    await expect(page.getByPlaceholder('Phone number')).toHaveAttribute('inputmode', 'numeric')
    await expect(page.getByPlaceholder('Phone number')).toHaveAttribute('pattern', '[0-9]*')
  })

  test('needs a shift, and the shift screen opens one with a PIN', async ({ page }) => {
    await page.getByRole('link', { name: 'Shift', exact: true }).click()
    await expect(page.getByTestId('open-shift')).toContainText('Demo Biller is on the counter')

    await page.getByTestId('close-shift').click()
    await page.getByRole('button', { name: 'Close shift' }).click()
    await expect(page.getByTestId('biller-grid')).toBeVisible()

    // The counter now says what to do rather than showing a dead Settle.
    await page.getByRole('link', { name: 'Counter' }).click()
    await expect(page.getByTestId('no-shift')).toContainText('No shift is open')
    await expect(page.getByTestId('settle')).toHaveCount(0)

    // A wrong PIN is refused with one sentence.
    await page.getByTestId('open-shift-link').click()
    await page.getByRole('button', { name: 'Demo Morning Biller' }).click()
    for (const digit of '9999') await page.getByRole('button', { name: digit, exact: true }).click()
    await expect(page.getByTestId('shift-error')).toContainText('did not unlock')

    // The right one hands the counter over.
    for (const digit of '1234') await page.getByRole('button', { name: digit, exact: true }).click()
    await expect(page.getByTestId('shift-status')).toContainText('Demo Morning Biller')
    await expect(page.getByTestId('bill-total')).toBeVisible()
  })
})

test.describe('the counter offline', () => {
  test('accumulates, escalates, and drains when the connection returns', async ({
    page,
    context,
  }) => {
    await page.goto('demo/biller')
    await expect(page.getByTestId('sync-indicator')).toHaveAttribute('data-sync', 'pending')

    await context.setOffline(true)

    // Five bills is the escalation threshold from src/domain/billing.ts.
    for (let index = 0; index < 5; index += 1) {
      await page.getByRole('button', { name: 'Classic Chicken Shawarma', exact: true }).click()
      await recordPaid(page)
      await expect(page.getByTestId('bill-total')).toHaveText('₹0')
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
      await expect(page.getByTestId('bill-panel')).toBeVisible()

      await testInfo.attach(`counter-${theme}`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      })
      expect(errors).toEqual([])
    })
  }
})

test.describe('manager billing history', () => {
  test('filters immutable bills, voids with guidance, clears an order and keeps delivery read-only', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('demo/admin/billing-history')
    await expect(page.getByRole('heading', { name: 'Billing history' })).toBeVisible()

    await page.getByLabel('Payment method').selectOption('zomato')
    const bill = page.getByRole('button', { name: /Bill \d+ · Sent/ }).first()
    await bill.click()
    await expect(page.getByRole('dialog')).toContainText('Revenue date')
    await page.getByLabel('Void reason').fill('Wrong item rung')
    await page.getByRole('button', { name: 'Void bill' }).click()
    await expect(
      page.getByText(/ring the corrected sale manually on the enrolled counter tablet/i),
    ).toBeVisible()

    await page.getByRole('tab', { name: /Open orders/ }).click()
    await page.getByLabel(/Reason to cancel order/).fill('Tablet unavailable')
    await page.getByRole('button', { name: 'Cancel order' }).click()
    await expect(page.getByText(/Nothing was transferred/)).toBeVisible()

    await page.getByRole('tab', { name: /Delivery/ }).click()
    await expect(
      page.getByText(/Customer details and command contents are never shown/),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: /Correct|Discard/ })).toHaveCount(0)
  })
})
