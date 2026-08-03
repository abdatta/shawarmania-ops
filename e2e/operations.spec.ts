import { expect, test, type Page } from '@playwright/test'

import { E2E_ORIGIN } from '../ports'

/**
 * The manager's four operational surfaces, walked the way a demo walks them.
 *
 * The gate for `ui-outlet-operations` is that menu, inventory, expenses and a
 * full day-close are all walkable — **including a low-stock warning and a
 * deliberate cash mismatch**. A screen that has only ever been seen balancing
 * has not been reviewed, so both awkward states are asserted rather than hoped
 * for.
 */

const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 1080, height: 810 },
] as const

async function setTheme(page: Page, theme: 'light' | 'dark') {
  await page.evaluate((value) => {
    localStorage.setItem('shawarmania.theme', value)
  }, theme)
}

test.describe('the operations surfaces', () => {
  test('walks menu, stock, expenses and a full day-close', async ({ page, baseURL }) => {
    const origin = new URL(baseURL ?? E2E_ORIGIN).origin
    const violations: string[] = []
    page.on('request', (request) => {
      if (new URL(request.url()).origin !== origin) violations.push(request.url())
    })

    await page.goto('demo/admin')

    // ── Menu ────────────────────────────────────────────────────────────────
    await page.getByRole('link', { name: 'Menu' }).click()
    await expect(page.getByTestId('menu-list')).toBeVisible()
    await expect(page.getByText('Classic Chicken Shawarma')).toBeVisible()
    await expect(page.getByText('Off the menu')).toBeVisible()

    // ── Stock, with the low-stock warning on screen ──────────────────────────
    await page.getByRole('link', { name: 'Stock' }).click()
    await expect(page.getByTestId('stock-list')).toBeVisible()
    await expect(page.getByText('Pita bread')).toBeVisible()
    await expect(page.getByText('Low stock')).toBeVisible()

    // The ledger behind a figure, at its own address.
    await page.getByRole('link', { name: 'Ledger' }).first().click()
    await expect(page.getByRole('table')).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Left' })).toBeVisible()
    await page.goBack()

    // ── Expenses, cash rows distinguishable from the rest ───────────────────
    await page.getByRole('link', { name: 'Expenses' }).click()
    await expect(page.getByTestId('expense-list')).toBeVisible()
    // The badge is one visible word; the rest of the sentence is announced only.
    await expect(page.locator('[data-testid^="cash-"]').first()).toContainText('Cash')
    await expect(page.getByTestId('expense-cash-total')).toBeVisible()

    // ── Daily cash, and a deliberate mismatch on the way out ────────────────
    await page.getByRole('link', { name: 'Cash' }).click()
    await expect(page.getByTestId('cash-figures')).toBeVisible()

    const expected = (await page.getByTestId('expected-closing').textContent()) ?? ''
    const expectedRupees = Number(expected.replace(/[₹,]/g, ''))
    await page.getByLabel(/Count the drawer/).fill(String(expectedRupees - 240))

    const live = page.getByTestId('live-difference')
    await expect(live).toHaveAttribute('data-difference', 'short')
    await expect(live).toContainText('-₹240')
    await expect(live).toContainText('missing from the drawer')

    await page.getByTestId('close-day-button').click()
    await page.getByRole('dialog').getByRole('button', { name: 'Close the day' }).click()

    const closed = page.getByTestId('closed-day')
    await expect(closed).toBeVisible()
    await expect(closed.getByTestId('closed-difference')).toHaveAttribute(
      'data-difference',
      'short',
    )
    // Closed for good: no way to do it again.
    await expect(page.getByTestId('close-day-button')).toHaveCount(0)

    expect(violations).toEqual([])
  })

  test('reports a bill that arrived after yesterday was closed', async ({ page }) => {
    await page.goto('demo/admin/cash')
    await expect(page.getByTestId('cash-figures')).toBeVisible()

    // Yesterday is the second option — today is the first.
    const options = page.getByTestId('cash-day').locator('option')
    await page
      .getByTestId('cash-day')
      .selectOption((await options.nth(1).getAttribute('value')) ?? '')

    const exception = page.getByTestId('reconciliation-exception')
    await expect(exception).toBeVisible()
    await expect(exception).toContainText('arrived after this day was closed')
    await expect(exception).toContainText('have not been changed')

    // Yesterday is closed, and closed with a real shortfall.
    const closed = page.getByTestId('closed-day')
    await expect(closed.getByTestId('closed-difference')).toHaveAttribute(
      'data-difference',
      'short',
    )
    await expect(page.getByTestId('close-day-button')).toHaveCount(0)
  })

  test('records a movement and a stock item’s figure follows its ledger', async ({ page }) => {
    await page.goto('demo/admin/inventory')
    const chicken = page
      .getByTestId('stock-list')
      .getByRole('listitem')
      .filter({ hasText: 'Chicken' })

    // Read the starting figure rather than pinning it: the scenario's stock is
    // chosen so the ledger reconciles with the bills that consumed it, and it
    // moves when the trade does. What is asserted is that recording 2.5 kg used
    // takes the figure down by 2.5 — and that the ledger says the same.
    const started = Number(/([\d.]+) kg/.exec((await chicken.innerText()) ?? '')?.[1])
    expect(started).toBeGreaterThan(2.5)
    const expected = `${Math.round((started - 2.5) * 1000) / 1000} kg`

    await chicken.getByRole('button', { name: 'Record' }).click()
    await page.getByLabel('What happened').selectOption('used')
    await page.getByLabel(/How much/).fill('2.5')
    await page.getByRole('button', { name: 'Record movement' }).click()

    await expect(chicken).toContainText(expected)

    await chicken.getByRole('link', { name: 'Ledger' }).click()
    await expect(page.getByRole('table')).toContainText(expected)
  })

  test('a Biller reads the menu and is offered nothing that changes it', async ({ page }) => {
    await page.goto('demo/biller/menu')
    await expect(page.getByTestId('menu-list')).toBeVisible()
    await expect(page.getByTestId('menu-read-only')).toContainText('changed by a manager')

    await expect(page.getByRole('button', { name: 'Turn off' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Add category' })).toHaveCount(0)
  })
})

for (const viewport of VIEWPORTS) {
  for (const theme of ['light', 'dark'] as const) {
    test(`the operations surfaces render in ${theme} on ${viewport.name}`, async ({
      page,
    }, testInfo) => {
      const errors: string[] = []
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text())
      })
      page.on('pageerror', (error) => errors.push(error.message))

      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.goto('demo/admin')
      await setTheme(page, theme)

      for (const [path, anchor] of [
        ['menu', 'menu-list'],
        ['inventory', 'stock-list'],
        ['expenses', 'expense-list'],
        ['cash', 'cash-figures'],
      ] as const) {
        await page.goto(`demo/admin/${path}`)
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
        await expect(page.getByTestId(anchor)).toBeVisible()
        await expect(page.getByTestId('demo-banner')).toBeVisible()

        await testInfo.attach(`${path}-${theme}-${viewport.name}`, {
          body: await page.screenshot(),
          contentType: 'image/png',
        })
      }

      expect(errors).toEqual([])
    })
  }
}
