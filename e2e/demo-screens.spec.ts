import { expect, test, type Page } from '@playwright/test'

/**
 * The four-shells × both-themes × both-viewports matrix (design D7/risk
 * note). Screenshots are attached to the report as review artifacts rather
 * than compared pixel-by-pixel — font rendering differs across the OSes CI
 * and laptops run, and a flaky gate teaches people to ignore it. The
 * assertions are what gate: shell chrome present, banner visible, correct
 * theme attribute, in every cell of the matrix.
 */

const SHELLS = [
  { segment: 'owner', anchor: 'All outlets' },
  { segment: 'admin', anchor: 'Outlet details' },
  { segment: 'counter', anchor: 'No shift open' },
  { segment: 'staff', anchor: 'Hello, Demo Staff' },
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
        await expect(page.getByText(shell.anchor)).toBeVisible()

        await testInfo.attach(`${shell.segment}-${theme}-${viewport.name}`, {
          body: await page.screenshot(),
          contentType: 'image/png',
        })
      }
    })
  }
}
