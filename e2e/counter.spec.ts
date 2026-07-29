import { expect, test, type Page } from '@playwright/test'

/**
 * The counter, in a real browser, on the device it actually runs on.
 *
 * The gate for `ui-billing-counter` is three clauses and each has a test here:
 * a full order rung and settled on a tablet viewport, the whole menu visible
 * without scrolling, and optional customer fields that never block a settle.
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

test.describe('the counter', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('demo/biller')
  })

  test('lands on the counter with a shift already open', async ({ page }) => {
    await expect(page).toHaveURL(/\/demo\/biller\/billing$/)
    await expect(page.getByTestId('shift-status')).toContainText('Demo Biller')
    await expect(page.getByTestId('sync-indicator')).toHaveAttribute('data-sync', 'synced')
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

  test('rings and settles a full order in two taps from a complete bill', async ({ page }) => {
    await page.getByRole('button', { name: 'Classic Chicken Shawarma', exact: true }).click()
    await page.getByRole('button', { name: 'Classic Chicken Shawarma', exact: true }).click()
    await page.getByRole('button', { name: 'Mozzarella Cheese Chicken Shawarma' }).click()
    await page.getByRole('button', { name: 'Fully Loaded Smashed Burger' }).click()

    // 139×2 + 199 + 250
    await expect(page.getByTestId('bill-total')).toHaveText('₹727')

    await page.getByTestId('method-cash').click()
    await page.getByTestId('settle').click()

    // Cleared for the next customer, immediately.
    await expect(page.getByTestId('bill-total')).toHaveText('₹0')

    const confirmation = page.getByTestId('settled-confirmation')
    await expect(confirmation).toContainText('₹727')
    await expect(page.getByTestId('provisional-reference')).toHaveText(
      /^Queued · [A-Z][0-9A-Z]{3}$/,
    )

    // It clears itself; nothing has to be acknowledged.
    await expect(confirmation).toBeHidden({ timeout: AFTER_SEND_MS })
  })

  test('settles with the customer fields left empty', async ({ page }) => {
    await page.getByRole('button', { name: 'Classic Chicken Shawarma', exact: true }).click()
    await expect(page.getByPlaceholder('Customer (optional)')).toHaveValue('')
    await expect(page.getByPlaceholder('Phone (optional)')).toHaveValue('')

    await page.getByTestId('method-upi').click()
    await page.getByTestId('settle').click()

    await expect(page.getByTestId('settled-confirmation')).toBeVisible()
    await expect(page.getByTestId('bill-total')).toHaveText('₹0')
  })

  test('refuses to settle without a payment method, and keeps the order', async ({ page }) => {
    await page.getByRole('button', { name: 'Classic Chicken Shawarma', exact: true }).click()
    await page.getByTestId('settle').click()

    await expect(page.getByTestId('counter-error')).toContainText('how this was paid')
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
    await page.getByPlaceholder('Customer (optional)').fill('Demo Regular')
    await page.getByTestId('method-cash').click()
    await page.getByTestId('settle').click()

    await page.getByTestId('undo-settle').click()

    await expect(page.getByTestId('bill-total')).toHaveText('₹159')
    await expect(page.getByPlaceholder('Customer (optional)')).toHaveValue('Demo Regular')
    await expect(page.getByTestId('settled-confirmation')).toBeHidden()
  })

  test('needs a shift, and the shift screen opens one with a PIN', async ({ page }) => {
    await page.getByRole('link', { name: 'Shift' }).click()
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
    await expect(page.getByTestId('sync-indicator')).toHaveAttribute('data-sync', 'synced')

    await context.setOffline(true)

    // Five bills is the escalation threshold from src/domain/billing.ts.
    for (let index = 0; index < 5; index += 1) {
      await page.getByRole('button', { name: 'Classic Chicken Shawarma', exact: true }).click()
      await page.getByTestId('method-cash').click()
      await page.getByTestId('settle').click()
      await expect(page.getByTestId('bill-total')).toHaveText('₹0')
    }

    await expect(page.getByTestId('sync-indicator')).toHaveAttribute('data-sync', 'stalled')
    await expect(page.getByTestId('sync-indicator')).toContainText('5 waiting')
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
