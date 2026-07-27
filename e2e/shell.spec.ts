import { expect, test } from '@playwright/test'

// baseURL carries the deployment sub-path, so every goto here is relative.
// A leading slash would resolve against the origin and skip the base.

test('the shell loads and shows the running build', async ({ page }) => {
  await page.goto('.')

  // Scoped to the header banner: the landing card also says "Shawarmania
  // Ops", and the shell chrome is what this test is about.
  await expect(page.getByRole('banner').getByText('Shawarmania Ops')).toBeVisible()

  // Load-bearing: the app shell is cached, so a bad deploy can persist on a
  // tablet nobody has refreshed. "What build is that tablet on?" has to be
  // answerable over the phone.
  await expect(page.getByTestId('build-version')).toContainText(/Build \S+/)
})

test('the theme toggle persists across a reload', async ({ page }) => {
  await page.goto('.')

  const initial = await page.locator('html').getAttribute('data-theme')
  const target = initial === 'dark' ? 'light' : 'dark'

  await page.getByRole('button', { name: `Switch to ${target} theme` }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', target)

  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', target)
})

test('an unknown route renders the not-found surface, not a hosting 404', async ({ page }) => {
  // GitHub Pages has no rewrites: this URL matches no file, so it is served the
  // 404.html copy of the shell and the SPA routes it. Asserting on a fresh
  // context (no service worker yet) is the point — this must work online, from
  // static hosting, not only via the worker's navigation fallback.
  await page.goto('nope/not/a/route')
  await expect(page.getByText('That page does not exist')).toBeVisible()
})

test('assets resolve under the deployment base path', async ({ page }) => {
  const failures: string[] = []
  page.on('requestfailed', (request) => failures.push(request.url()))
  page.on('response', (response) => {
    if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`)
  })

  await page.goto('.')
  await expect(page.getByRole('banner').getByText('Shawarmania Ops')).toBeVisible()

  // An absolute `/assets/...` left behind when the base changed shows up here
  // as a 404 rather than as a blank screen on someone's tablet.
  expect(failures).toEqual([])
})
