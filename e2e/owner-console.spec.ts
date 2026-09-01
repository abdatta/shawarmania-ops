import { expect, test, type Page } from '@playwright/test'

import { E2E_ORIGIN } from '../ports'

/**
 * The demo milestone's own gate: **a single uninterrupted walkthrough of all
 * four roles, with internally consistent mock data** — a busy trading day whose
 * bills and drawer counts reconcile with each other.
 *
 * The reconciliation assertions here deliberately compare figures reached
 * through *different adapters*: the owner console reads `insights` and the
 * drawer reads `cashDrawer`. Two screens agreeing because they call the same
 * method proves nothing; two screens agreeing across two derivations is the
 * property the whole scenario dataset exists to have.
 *
 * **It was a good deal larger before #51.** Compare, P&L, Reports and the alert
 * thread were all walked here, and all four are deleted — what is left is the
 * console, the outlet day view, and the cross-outlet reconciliation that was
 * always the point of the file.
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

test('the console’s cash difference is the one the drawer recorded', async ({ page }) => {
  await openDemo(page, 'demo/owner')

  // The owner's route to the number: an attention chip on the console, derived
  // by the insights adapter.
  //
  // That derivation used to read `daily_cash_records`, and
  // `cash-is-counted-not-closed` (#11) stopped anything writing that table. It
  // now reads the drawer observation inside the date — which is what keeps the
  // claim this test makes true: there is exactly one place the figure comes from.
  const attention = page.locator('[data-testid^="attention-"]').first()
  await expect(attention).toContainText('short')
  const fromConsole = paiseFrom(await attention.innerText())

  // The manager's route to the same number: the drawer's own recent counts.
  await openDemo(page, 'demo/admin/drawer')
  await expect(page.getByTestId('recent-counts')).toBeVisible()

  const counts = await page.getByTestId('recent-counts').innerText()
  expect(counts).toContain(
    // The chip's rupees, formatted the same way the surface formats them.
    new Intl.NumberFormat('en-IN').format(Math.abs(fromConsole) / 100),
  )
})

test('an outlet opens read-only, and says so', async ({ page }) => {
  await openDemo(page, 'demo/owner')
  await page.locator('[data-testid^="open-outlet-"]').first().click()

  await expect(page).toHaveURL(/\/demo\/owner\/outlet\//)
  await expect(page.getByTestId('read-only-notice')).toContainText('not working in it')
  await expect(page.getByTestId('outlet-day-sales')).toBeVisible()
  await expect(page.getByTestId('outlet-day-attendance')).toBeVisible()

  // #51 took the low-stock and open-alerts cards with their surfaces, and the
  // link to Reports with it. Asserted as absence, because a card pointing at a
  // screen that no longer exists is the regression worth staying fixed against.
  await expect(page.getByTestId('outlet-day-stock')).toHaveCount(0)
  await expect(page.getByTestId('outlet-day-alerts')).toHaveCount(0)
  await expect(page.getByRole('link', { name: /over a period/i })).toHaveCount(0)
})

test('the whole owner walk stays inside the app origin', async ({ page, baseURL }) => {
  const origin = new URL(baseURL ?? E2E_ORIGIN).origin
  const violations: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== origin) violations.push(request.url())
  })

  for (const path of [
    'demo/owner',
    'demo/owner/outlets',
    'demo/owner/drawer',
    'demo/owner/ledger',
    'demo/admin',
    'demo/admin/outlets',
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
  { path: 'demo/owner/outlets', testId: 'outlet-list' },
  { path: 'demo/owner/billing-history', testId: 'manager-bill-list' },
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
