import { expect, test, type Page } from '@playwright/test'

import { E2E_ORIGIN } from '../ports'

/**
 * The demo milestone's own gate: **a single uninterrupted walkthrough of all
 * four roles, with internally consistent mock data** — a busy trading day whose
 * bills, stock movements, cash close and alert all reconcile with each other.
 *
 * The reconciliation assertions here deliberately compare figures reached
 * through *different adapters*: the owner console reads `insights`, the cash
 * screen reads `dailyCash`, and the stock list reads `inventory`. Two screens
 * agreeing because they call the same method proves nothing; two screens
 * agreeing across two derivations is the property the whole scenario dataset
 * exists to have.
 */

/** `₹1,234` → 123400 paise, so figures can be compared rather than string-matched. */
function paiseFrom(text: string): number {
  const match = /₹\s?([\d,]+(?:\.\d+)?)/.exec(text)
  if (!match?.[1]) throw new Error(`No rupee amount in: ${text}`)
  return Math.round(Number(match[1].replace(/,/g, '')) * 100)
}

async function openDemo(page: Page, path: string) {
  await page.goto(path)
  await expect(page.getByTestId('demo-banner')).toBeVisible()
}

test('the owner console shows both outlets, each with its own figures', async ({ page }) => {
  await openDemo(page, 'demo/owner')

  await expect(page.getByRole('heading', { name: 'Shawarmania Kalyani' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Shawarmania Kanchrapara' })).toBeVisible()

  const cards = page.locator('[data-testid^="outlet-card-"]')
  await expect(cards).toHaveCount(2)

  // Two shops of genuinely different sizes. Identical figures would make the
  // console — and the comparison behind it — unreadable.
  const sales = page.locator('[data-testid^="sales-"]')
  const [first, second] = await sales.allTextContents()
  expect(first).not.toBe(second)
})

test('the console’s cash difference is the one the manager signed off', async ({ page }) => {
  await openDemo(page, 'demo/owner')

  // The owner's route to the number: an attention chip on the console, derived
  // by the insights adapter from yesterday's closed record.
  const attention = page.locator('[data-testid^="attention-"]').first()
  await expect(attention).toContainText('short')
  const fromConsole = paiseFrom(await attention.innerText())

  // The manager's route to the same number: the cash screen's own closed-day
  // snapshot, through the daily-cash adapter.
  await openDemo(page, 'demo/admin/cash')
  const dayPicker = page.getByTestId('cash-day')
  const yesterday = await dayPicker.locator('option').nth(1).getAttribute('value')
  await dayPicker.selectOption(yesterday ?? '')

  const closed = page.getByTestId('closed-difference')
  await expect(closed).toBeVisible()
  expect(Math.abs(paiseFrom(await closed.innerText()))).toBe(Math.abs(fromConsole))
})

test('the console’s low-stock count is the stock the manager can see', async ({ page }) => {
  await openDemo(page, 'demo/owner')
  const attention = page.locator('[data-testid^="attention-"]').first()
  await expect(attention).toContainText('low on stock')

  // The chip says one item; the manager's list has exactly one marked.
  await openDemo(page, 'demo/admin/inventory')
  await expect(page.getByText('Low stock')).toHaveCount(1)
})

test('the comparison states its basis and recomputes when it changes', async ({ page }) => {
  await openDemo(page, 'demo/owner/comparison')

  await expect(page.getByText('Shawarmania Kalyani')).toBeVisible()
  await expect(page.getByText('Shawarmania Kanchrapara')).toBeVisible()

  const note = page.getByTestId('comparison-basis-note')
  await expect(note).toContainText('Cash basis')
  const before = await page.getByTestId('comparison-total-profit').innerText()

  await page.getByTestId('comparison-basis').selectOption('consumption')
  await expect(note).toContainText('Consumption basis')
  await expect(note).toContainText('never both subtracted')
  await expect(page.getByTestId('comparison-total-profit')).not.toHaveText(before)
})

test('profit is never shown without the basis it was computed on', async ({ page }) => {
  await openDemo(page, 'demo/owner/pnl')

  const figure = page.getByTestId('pnl-profit')
  await expect(figure).toHaveAttribute('data-basis', 'consumption')
  await expect(page.getByTestId('pnl-profit-basis')).toContainText('Consumption basis')

  // And the working adds up to the figure, so the number can be checked.
  const sales = paiseFrom(await page.getByText('Sales', { exact: true }).locator('..').innerText())
  expect(sales).toBeGreaterThan(0)

  await page.getByTestId('pnl-basis').selectOption('cash')
  await expect(figure).toHaveAttribute('data-basis', 'cash')
  await expect(page.getByTestId('pnl-profit-basis')).toContainText('Cash basis')
})

test('reports summarise a period and produce no file of invented revenue', async ({ page }) => {
  await openDemo(page, 'demo/owner/reports')

  await expect(page.getByTestId('report-sales')).toBeVisible()
  await expect(page.getByTestId('report-days')).toBeVisible()
  await expect(page.getByTestId('export-unavailable')).toContainText('cannot be exported')

  // Absent, not disabled: there is nothing to press, which is what makes
  // exporting fabricated figures impossible by construction.
  await expect(page.getByRole('button', { name: /export|download/i })).toHaveCount(0)
  await expect(page.locator('a[download]')).toHaveCount(0)
})

test('an outlet opens read-only, and says so', async ({ page }) => {
  await openDemo(page, 'demo/owner')
  await page.locator('[data-testid^="open-outlet-"]').first().click()

  await expect(page).toHaveURL(/\/demo\/owner\/outlet\//)
  await expect(page.getByTestId('read-only-notice')).toContainText('not working in it')
  await expect(page.getByTestId('outlet-day-sales')).toBeVisible()
  await expect(page.getByTestId('outlet-day-stock')).toContainText('Pita bread')
})

test('an alert raised by the manager reaches the owner and is worked through', async ({ page }) => {
  await openDemo(page, 'demo/admin/alerts')

  await page.getByTestId('raise-alert').click()
  await page.getByLabel('Subject').fill('Freezer is not holding temperature')
  await page.getByLabel('What happened').fill('It read −4 this morning. Nothing thrown away yet.')
  await page.getByLabel('How urgent').selectOption('urgent')
  await page.getByRole('button', { name: 'Raise it' }).click()

  await expect(page.getByTestId('alert-list')).toContainText('Freezer is not holding temperature')

  // Flip roles in the banner — the demonstration the proposal asks for, and
  // the reason the demo's data outlives a role switch.
  //
  // Client-side throughout: a full page load would legitimately start a fresh
  // demo, since the dataset is built per mount. That is the documented
  // behaviour of a reload, and it is not what flipping roles does.
  await page
    .getByRole('navigation', { name: 'Demo role switcher' })
    .getByRole('link', { name: 'Owner' })
    .click()
  await expect(page.getByRole('heading', { name: 'All outlets' })).toBeVisible()
  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('link', { name: 'Alerts' })
    .first()
    .click()
  await expect(page).toHaveURL(/\/demo\/owner\/alerts$/)

  const raised = page.getByTestId('alert-list').getByText('Freezer is not holding temperature')
  await expect(raised).toBeVisible()
  await raised.click()

  // Replying does not move it along.
  await page.getByTestId('alert-reply').fill('Call the engineer this morning.')
  await page.getByRole('button', { name: 'Send reply' }).click()
  await expect(page.getByTestId('alert-responses')).toContainText('Call the engineer this morning.')
  await expect(page.getByTestId('alert-detail')).toContainText('Status — Open')

  // Acknowledgement cannot be skipped.
  await expect(page.getByTestId('set-status-closed')).toHaveCount(0)
  await page.getByTestId('set-status-acknowledged').click()
  await page.getByTestId('set-status-resolved').click()
  await page.getByTestId('set-status-closed').click()

  await expect(page.getByTestId('alert-terminal')).toContainText('closed')
  await expect(page.getByTestId('set-status-open')).toHaveCount(0)
})

test('start again puts the scenario back and keeps the reader in place', async ({ page }) => {
  await openDemo(page, 'demo/admin/alerts')
  const before = await page.getByTestId('alert-list').locator('> li').count()

  await page.getByTestId('raise-alert').click()
  await page.getByLabel('Subject').fill('Reset probe')
  await page.getByLabel('What happened').fill('Raised to be discarded.')
  await page.getByRole('button', { name: 'Raise it' }).click()
  await expect(page.getByTestId('alert-list')).toContainText('Reset probe')

  await page.getByTestId('demo-reset').click()
  await expect(page.getByText('Start the demo again?')).toBeVisible()
  await page.getByRole('button', { name: 'Discard and start again' }).click()

  await expect(page.getByTestId('alert-list')).not.toContainText('Reset probe')
  await expect(page.getByTestId('alert-list').locator('> li')).toHaveCount(before)
  // Same role, same surface — a reset that sent the reader back to the owner
  // would cost them their place mid-walkthrough.
  await expect(page).toHaveURL(/\/demo\/admin\/alerts$/)
})

test('the whole owner walk stays inside the app origin', async ({ page, baseURL }) => {
  const origin = new URL(baseURL ?? E2E_ORIGIN).origin
  const violations: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== origin) violations.push(request.url())
  })

  for (const path of [
    'demo/owner',
    'demo/owner/comparison',
    'demo/owner/pnl',
    'demo/owner/reports',
    'demo/owner/alerts',
    'demo/admin/pnl',
    'demo/admin/alerts',
  ]) {
    await openDemo(page, path)
  }

  await openDemo(page, 'demo/owner')
  await page.locator('[data-testid^="open-outlet-"]').first().click()
  await expect(page.getByTestId('read-only-notice')).toBeVisible()

  expect(violations).toEqual([])
})

const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 1080, height: 810 },
] as const

const OWNER_SURFACES = [
  { path: 'demo/owner', testId: 'outlet-scope' },
  { path: 'demo/owner/comparison', testId: 'comparison-basis-note' },
  { path: 'demo/owner/pnl', testId: 'pnl-profit-basis' },
  { path: 'demo/owner/reports', testId: 'export-unavailable' },
  { path: 'demo/owner/alerts', testId: 'alert-list' },
] as const

for (const viewport of VIEWPORTS) {
  for (const theme of ['light', 'dark'] as const) {
    test(`the owner surfaces render in ${theme} on ${viewport.name}`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.goto('.')
      await page.evaluate((value) => localStorage.setItem('shawarmania.theme', value), theme)

      for (const surface of OWNER_SURFACES) {
        await openDemo(page, surface.path)
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
        await expect(page.getByTestId(surface.testId)).toBeVisible()

        // The page itself must never scroll sideways on a phone.
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        )
        expect(overflow, `${surface.path} overflows horizontally`).toBeLessThanOrEqual(1)

        await testInfo.attach(`${surface.path.replace(/\//g, '-')}-${theme}-${viewport.name}`, {
          body: await page.screenshot(),
          contentType: 'image/png',
        })
      }
    })
  }
}
