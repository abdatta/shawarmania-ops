import { expect, test, type Page } from '@playwright/test'

import { E2E_ORIGIN } from '../ports'

/**
 * The manager's operational surfaces, walked the way a demo walks them.
 *
 * The gate for `ui-outlet-operations` was that menu, inventory, expenses and a
 * full day-close are all walkable, **including a deliberate cash mismatch** — a
 * screen that has only ever been seen balancing has not been reviewed, so the
 * awkward state is asserted rather than hoped for.
 *
 * Two of those four are no longer here. #11 replaced the day close with a
 * counted drawer and a derived Ledger, and #51 deleted Stock outright, which
 * takes the low-stock warning with it. What survives is the mismatch, which was
 * always the assertion that mattered.
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
  test('walks menu, expenses and a drawer count', async ({ page, baseURL }) => {
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

    // ── Expenses, cash rows distinguishable from the rest ───────────────────
    //
    // One Expenses screen now, in both modes. There used to be two entries under
    // this label — a `demo`-gated screen the walkthrough showed and the live list
    // real mode showed — and `retire-the-manual-ledger` (#12) removed the demo
    // one, so the walkthrough walks the surface that actually records a spend.
    await page.getByRole('link', { name: 'Expenses' }).click()
    await expect(page.getByTestId('ledger-expense-list')).toBeVisible()
    // The badge is one visible word; the rest of the sentence is announced only.
    await expect(page.locator('[data-testid^="ledger-cash-"]').first()).toContainText('Cash')
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
    await page.goto('demo/admin/ledger')
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
    await page.getByTestId('statement-step-back').click()
    await expect(page.getByTestId('left-is-not-opening')).toContainText('left')

    // **One reading, one entry.** Decision 17 gave the owner two entries so they
    // could open the derived statement and the notebook on the same day and
    // compare them; `retire-the-manual-ledger` (#12) ended that overlap once the
    // comparison had been made, and the `Notebook` entry went with the surface.
    const nav = page.getByRole('navigation', { name: 'Primary' }).first()
    await expect(nav.getByRole('link', { name: 'Ledger', exact: true })).toHaveAttribute(
      'href',
      /\/ledger$/,
    )
    await expect(nav.getByRole('link', { name: 'Notebook' })).toHaveCount(0)
    // And recording an expense is reachable, which #11 briefly took away. There
    // is exactly one Expenses entry, in both modes, pointing at the one surface
    // that records a spend — #12 removed the `demo`-gated second screen that
    // used to carry this label. `src/gates/registry.test.ts` asserts that.
    await expect(nav.getByRole('link', { name: 'Expenses' })).toHaveCount(1)
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
        ['outlets', 'outlet-list'],
        ['ledger/expenses', 'ledger-expense-list'],
        // `cash` was here until #11 made the day-close screen `hidden`. Both of
        // its replacements are walked instead, in both themes on both viewports.
        ['drawer', 'drawer-balance'],
        ['ledger', 'ledger-revenue'],
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
