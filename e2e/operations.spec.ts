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
  test('walks menu, stock, expenses and a drawer count', async ({ page, baseURL }) => {
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
    await expect(page.getByText('OFF', { exact: true })).toBeVisible()

    // ── Stock, with the low-stock warning on screen ──────────────────────────
    await page.getByRole('link', { name: 'Stock' }).click()
    await expect(page.getByTestId('stock-list')).toBeVisible()
    await expect(page.getByText('Pita bread')).toBeVisible()
    await expect(page.getByText('Low stock')).toBeVisible()

    // The movements behind a figure, at their own address.
    await page.getByRole('link', { name: 'Movements' }).first().click()
    await expect(page.getByRole('table')).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Left' })).toBeVisible()
    await page.goBack()

    // ── Expenses, cash rows distinguishable from the rest ───────────────────
    await page.getByRole('link', { name: 'Expenses' }).click()
    await expect(page.getByTestId('expense-list')).toBeVisible()
    // The badge is one visible word; the rest of the sentence is announced only.
    await expect(page.locator('[data-testid^="cash-"]').first()).toContainText('Cash')
    await expect(page.getByTestId('expense-cash-total')).toBeVisible()

    // ── The drawer, and a deliberate mismatch on the way out ────────────────
    //
    // This leg used to walk a day close. `cash-is-counted-not-closed` (#11)
    // removed that: the drawer is a running balance counted mid-shift, so the
    // surface opens on a figure rather than on a date, and there is no seal.
    await page.getByRole('link', { name: 'Drawer' }).click()
    await expect(page.getByTestId('drawer-balance')).toBeVisible()

    // It opens on a balance, not a date picker. That is the whole shape change.
    await expect(page.getByTestId('expected-now')).toBeVisible()
    await expect(page.getByTestId('cash-day')).toHaveCount(0)

    await page.getByTestId('open-count').click()

    // **The direction, not a predicted figure.** An earlier version of this test
    // computed the exact shortfall from the rendered balance, which coupled it to
    // the demo fixture's arithmetic and read the wrong sign the moment that moved.
    // What this leg is for is that the difference appears at all, immediately, and
    // says which way it goes; the arithmetic itself is proved in
    // `src/features/cash/drawer-arithmetic.test.ts` against known inputs.
    const difference = page.getByTestId('count-difference')

    await page.getByTestId('counted-input').fill('1')
    await expect(difference).toContainText('short')

    await page.getByTestId('counted-input').fill('99999999')
    await expect(difference).toContainText('over')

    // A minus in the collection field means money going IN, and it says so
    // immediately rather than at submission.
    await page.getByTestId('collecting-input').fill('-1000')
    await expect(page.getByTestId('negative-warning')).toContainText('ADDING money to the drawer')

    // Back to an ordinary collection, and save.
    await page.getByTestId('collecting-input').fill('500')
    await expect(page.getByTestId('negative-warning')).toHaveCount(0)
    await page.getByTestId('away-reason').fill('walked through on the tablet')
    await page.getByTestId('save-count').click()

    // No seal, and nothing froze: the primary action is still there afterwards,
    // because a drawer can be counted again whenever somebody counts it.
    await expect(page.getByTestId('open-count')).toBeVisible()
    await expect(page.getByTestId('recent-counts')).toBeVisible()

    expect(violations).toEqual([])
  })

  test('the Ledger reads a day with nothing to type into it', async ({ page }) => {
    // The counterpart of the drawer: #11 replaced the manual Ledger form in the
    // navigation with a statement derived on read. The assertion that matters is
    // the negative one.
    await page.goto('demo/admin/statement')
    await expect(page.getByTestId('ledger-revenue')).toBeVisible()
    await expect(page.getByTestId('ledger-drawer')).toBeVisible()
    await expect(page.getByTestId('ledger-expenses')).toBeVisible()

    // Zero editable figures, enumerated rather than sampled — and scoped to the
    // reading itself. The shell's outlet selector is a `select`, and it is chrome
    // rather than a figure: the claim is that no REVENUE, DRAWER or EXPENSE figure
    // on this surface is an input.
    for (const section of ['ledger-revenue', 'ledger-drawer', 'ledger-expenses'] as const) {
      const card = page.getByTestId(section)
      await expect(card.locator('input')).toHaveCount(0)
      await expect(card.locator('textarea')).toHaveCount(0)
      await expect(card.locator('select')).toHaveCount(0)
      await expect(card.locator('[contenteditable="true"]')).toHaveCount(0)
    }

    // The float left and the closing balance are never one word. On a `carried`
    // date the chip is deliberately absent — there was no count, so there is no
    // float left to distinguish from anything — so step back to a counted one.
    await page.getByTestId('day-back').click()
    await expect(page.getByTestId('left-is-not-opening')).toContainText('left')

    // The manual form still resolves at its own route — the fallback is a tab,
    // not a runtime toggle — while having no navigation entry.
    await expect(
      page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Ledger' }),
    ).toHaveAttribute('href', /statement$/)
    await page.goto('demo/admin/ledger')
    await expect(page.getByTestId('ledger-view')).toBeVisible()
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

    await chicken.getByRole('link', { name: 'Movements' }).click()
    await expect(page.getByRole('table')).toContainText(expected)
  })

  test('a Biller has no menu page, and the counter answers what it used to', async ({ page }) => {
    // The read-only Menu screen is retired: the Counter's own menu column carries
    // every item, price and availability marker, permanently, beside the bill.
    await page.goto('demo/biller')
    await expect(page.getByRole('link', { name: 'Menu' })).toHaveCount(0)

    const menu = page.getByTestId('menu-grid')
    await expect(menu.getByRole('button', { name: 'Classic Chicken Shawarma' })).toBeVisible()
    await expect(menu).toContainText('₹139')
    // Unavailable items stay on the grid, marked, and without a price to quote.
    const off = menu.getByRole('button', { name: /Stuffed Lebanese.*off the menu/ })
    await expect(off).toContainText('Off')
    await expect(off).not.toContainText('₹')

    // And the route itself no longer resolves to a menu for this role.
    await page.goto('demo/biller/menu')
    await expect(page.getByTestId('menu-list')).toHaveCount(0)
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
        // `cash` was here until #11 made the day-close screen `hidden`. Both of
        // its replacements are walked instead, in both themes on both viewports.
        ['drawer', 'drawer-balance'],
        ['statement', 'ledger-revenue'],
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
