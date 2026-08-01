import { expect, test } from '@playwright/test'

const CONNECTION_MESSAGE =
  "Could not reach Shawarmania. Check this device's internet connection and try again."

test('an unreachable Auth host gives enumeration-safe connection guidance', async ({
  page,
}, testInfo) => {
  const consoleErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  await page.route('https://demo-only.supabase.co/**', (route) => route.abort('failed'))
  await page.addInitScript(() => localStorage.setItem('shawarmania.theme', 'light'))
  await page.goto('sign-in')

  await page.getByLabel('Username or email', { exact: true }).fill('nobody.at.all')
  await page.getByLabel('Password').fill('not-the-password')
  await page.getByRole('button', { name: 'Sign in' }).click()

  const error = page.getByTestId('signin-error')
  await expect(error).toHaveText(CONNECTION_MESSAGE)
  await expect(error).not.toContainText(/username|password|details are not right/i)
  await expect(page.getByLabel('Username or email', { exact: true })).toHaveValue('nobody.at.all')
  await expect(page).toHaveURL(/\/sign-in$/)

  for (const [viewport, size] of [
    ['phone', { width: 390, height: 844 }],
    ['tablet', { width: 1080, height: 810 }],
  ] as const) {
    await page.setViewportSize(size)
    for (const theme of ['light', 'dark'] as const) {
      const currentTheme = await page.locator('html').getAttribute('data-theme')
      if (currentTheme !== theme) {
        await page
          .getByRole('button', {
            name: theme === 'dark' ? 'Switch to dark theme' : 'Switch to light theme',
          })
          .click()
      }
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await expect(error).toBeVisible()
      expect(
        await page.locator('body').evaluate((body) => body.scrollWidth <= body.clientWidth),
      ).toBe(true)
      await testInfo.attach(`unreachable-${viewport}-${theme}`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      })
    }
  }

  // Chromium reports the deliberately aborted Auth fetch at the resource
  // layer. Require that one expected transport entry and no application error.
  expect(consoleErrors).toEqual(['Failed to load resource: net::ERR_FAILED'])
})
