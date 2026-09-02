import { expect, test, type Page } from '@playwright/test'
import { DEMO_HELPER_ACCOUNT_ID } from '../src/data-access/mock/fixtures/accounts'

/**
 * The four-shells × both-themes × both-viewports matrix (design D7/risk
 * note). Screenshots are attached to the report as review artifacts rather
 * than compared pixel-by-pixel — font rendering differs across the OSes CI
 * and laptops run, and a flaky gate teaches people to ignore it. The
 * assertions are what gate: shell chrome present, banner visible, correct
 * theme attribute, in every cell of the matrix.
 */

/**
 * The owner's anchor is matched by role: "All outlets" is both the console's
 * heading and an option in its outlet switcher, and a bare text match is
 * ambiguous across the two.
 */
const SHELLS = [
  { segment: 'owner', anchor: (page: Page) => page.getByRole('heading', { name: 'All outlets' }) },
  // The manager's home is the outlets overview since #51, scoped by the
  // database to the one outlet they run — so the page is titled for that
  // outlet, and the card below it drops the name rather than repeating it.
  {
    segment: 'admin',
    anchor: (page: Page) => page.getByRole('heading', { level: 1, name: 'Shawarmania Kalyani' }),
  },
  // The Biller's shell is the enrolled tablet's own, so its chrome names the
  // *device*: a tablet is set up rather than signed in. The demo store starts
  // with a shift open on it, so a walkthrough lands able to ring a bill rather
  // than at the request screen.
  {
    segment: 'biller',
    anchor: (page: Page) => page.getByRole('heading', { name: 'Counter tablet' }),
  },
  { segment: 'staff', anchor: (page: Page) => page.getByText('Hello, Demo Staff') },
] as const

const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 1080, height: 810 },
] as const

const THEMES = ['light', 'dark'] as const

async function setTheme(page: Page, theme: 'light' | 'dark') {
  await page.evaluate((value) => {
    localStorage.setItem('shawarmania.theme', value)
  }, theme)
}

for (const viewport of VIEWPORTS) {
  for (const theme of THEMES) {
    test(`demo shells render in ${theme} on ${viewport.name}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.goto('.')
      await setTheme(page, theme)

      for (const shell of SHELLS) {
        await page.goto(`demo/${shell.segment}`)
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
        await expect(page.getByTestId('demo-banner')).toBeVisible()
        await expect(shell.anchor(page)).toBeVisible()

        await testInfo.attach(`${shell.segment}-${theme}-${viewport.name}`, {
          body: await page.screenshot(),
          contentType: 'image/png',
        })
      }

      // The historical escape hatch is a real working state, not merely the
      // attendance landing page. Keep its date-specific copy and time-only
      // sheet readable in every visual cell the surface supports.
      await page.goto('demo/admin/attendance')
      await page.getByRole('button', { name: 'Previous day' }).click()
      const helper = page.getByTestId(`expand-${DEMO_HELPER_ACCOUNT_ID}`)
      if ((await helper.getAttribute('aria-expanded')) === 'false') await helper.click()
      await page.getByTestId(`manual-${DEMO_HELPER_ACCOUNT_ID}`).click()
      await page.getByLabel('When did they arrive?').fill('09:00')
      await expect(page.getByRole('heading', { name: 'Record an arrival' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Record it under my name' })).toBeEnabled()
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await testInfo.attach(`historical-arrival-${theme}-${viewport.name}`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      })
    })
  }
}
