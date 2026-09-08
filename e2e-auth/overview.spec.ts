import { expect, test, type Page } from '@playwright/test'

const KAL = '00000000-0000-4000-a000-000000000001'
const KPA = '00000000-0000-4000-a000-000000000002'

async function signIn(page: Page, username: string) {
  await page.goto('sign-in')
  await page.getByLabel('Username or email', { exact: true }).fill(username)
  await page.getByLabel('Password').fill('shawarmania-local')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible()
}

test('live Overview arrives independently and fits phone/tablet in both themes', async ({
  page,
}, testInfo) => {
  let release!: () => void
  const monthly = new Promise<void>((resolve) => {
    release = resolve
  })
  const errors: string[] = []
  const failedReads: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('response', (response) => {
    if (response.url().includes('/rpc/overview_') && response.status() >= 400)
      failedReads.push(response.url())
  })
  await page.route('**/rest/v1/rpc/overview_revenue', async (route) => {
    await monthly
    await route.continue()
  })
  try {
    await signIn(page, 'owner')
    await expect(page.getByTestId(`sales-${KAL}`)).toBeVisible()
    await expect(
      page.getByTestId(`outlet-card-${KAL}`).getByRole('link', { name: /Drawer cash.*Left/ }),
    ).toBeVisible()
    await expect(page.getByTestId(`revenue-${KAL}`)).toHaveCount(0)
    await expect(page.getByTestId(`outlet-card-${KPA}`)).toBeVisible()
  } finally {
    release()
  }
  await expect(page.getByTestId(`revenue-${KAL}`)).toBeVisible()
  for (const viewport of [
    { name: 'phone', width: 390, height: 844 },
    { name: 'tablet', width: 1080, height: 810 },
  ]) {
    await page.setViewportSize(viewport)
    for (const theme of ['light', 'dark']) {
      await page.evaluate((value) => localStorage.setItem('shawarmania.theme', value), theme)
      await page.reload()
      await expect(page.getByTestId(`revenue-${KAL}`)).toBeVisible()
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(1)
      await page.screenshot({
        path: testInfo.outputPath(`live-overview-${theme}-${viewport.name}.png`),
        fullPage: true,
      })
    }
  }
  await page.getByTestId(`open-outlet-${KAL}`).click()
  await expect(page).toHaveURL(new RegExp(`devices/${KAL}`))
  await expect(page.getByRole('heading', { name: 'Tablets', exact: true })).toBeVisible()
  expect(errors).toEqual([])
  expect(failedReads).toEqual([])
})

test('live manager Overview contains only assigned outlets', async ({ page }) => {
  await signIn(page, 'admin.kalyani')
  await expect(page.getByTestId(`sales-${KAL}`)).toBeVisible()
  await expect(page.locator('[data-testid^="outlet-card-"]')).toHaveCount(1)
  await expect(page.getByTestId(`outlet-card-${KPA}`)).toHaveCount(0)
  await page
    .getByTestId(`outlet-card-${KAL}`)
    .getByRole('link', { name: /revenue/ })
    .click()
  await expect(page).toHaveURL(new RegExp(`ledger\\?outlet=${KAL}&view=month&month=`))
  await page.reload()
  await expect(page.getByRole('button', { name: 'The month', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})
