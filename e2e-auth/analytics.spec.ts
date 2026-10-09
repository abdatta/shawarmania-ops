import { expect, test } from '@playwright/test'

for (const [username, segment] of [
  ['owner', 'owner'],
  ['admin.kalyani', 'admin'],
]) {
  test(`${segment} reads both live Analytics pages`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto('sign-in')
    await page.getByLabel('Username or email', { exact: true }).fill(username!)
    await page.getByLabel('Password').fill('shawarmania-local')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page).not.toHaveURL(/\/sign-in$/)
    const analyticsRequests: Record<string, unknown>[] = []
    const seriesRequests: Record<string, unknown>[] = []
    page.on('request', (r) => {
      if (r.url().endsWith('/rpc/sales_analytics')) analyticsRequests.push(r.postDataJSON())
      if (r.url().endsWith('/rpc/sales_analytics_series')) seriesRequests.push(r.postDataJSON())
    })
    for (const route of ['items', 'sales']) {
      const response = page.waitForResponse((r) => r.url().endsWith('/rpc/sales_analytics'))
      const series =
        route === 'items'
          ? page.waitForResponse((r) => r.url().endsWith('/rpc/sales_analytics_series'))
          : null
      await page.goto(`${segment}/analytics/${route}?from=2020-01-01&to=2020-01-07`)
      const result = await response
      expect(result.status()).toBe(200)
      const data = await result.json()
      expect(data.days).toHaveLength(route === 'items' ? 2 : 14)
      expect(data[route === 'items' ? 'hours' : 'items']).toHaveLength(0)
      console.info(
        segment + ' ' + route + ' 7d/2 response bytes: ' + (await result.body()).byteLength,
      )
      if (series) {
        // The Items chart: every dish, two windows of seven days, two arrays.
        const chart = await (await series).json()
        expect(Object.keys(chart).sort()).toEqual(['from', 'revenue', 'units'])
        expect(chart.units).toHaveLength(14)
        await expect(page.getByTestId('items-trend-card')).toBeVisible()
      }
      await expect(
        page.getByRole('heading', { name: 'No settled sales in this period' }),
      ).toBeVisible()
      await expect(page.getByTestId('demo-banner')).toHaveCount(0)
    }
    const reads = analyticsRequests.length
    for (const metric of ['Orders', 'AOV']) {
      await page.getByRole('button', { name: /^Measure:/ }).click()
      await page
        .getByRole('dialog', { name: 'Measure' })
        .getByRole('button', { name: metric, exact: true })
        .click()
      await expect(page.getByRole('heading', { name: metric, exact: true })).toBeVisible()
    }
    await page.getByRole('button', { name: 'Group by: Day' }).click()
    await page.getByRole('button', { name: 'Week', exact: true }).click()
    await page.getByRole('button', { name: 'Table', exact: true }).click()
    await expect(page.getByTestId('sales-trend-table')).toBeVisible()
    await page.getByRole('button', { name: 'Group by: Week' }).click()
    await page.getByRole('button', { name: 'Hour', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Group by: Hour' })).toBeVisible()
    expect(analyticsRequests.length).toBe(reads)
    const response = page.waitForResponse((r) => r.url().includes('/rpc/sales_analytics'))
    await page.getByRole('button', { name: 'Compare periods: 2 periods' }).click()
    await page.getByRole('button', { name: '4 periods', exact: true }).click()
    const four = await response
    expect((await four.json()).days).toHaveLength(28)
    expect(analyticsRequests.at(-1)).toMatchObject({ p_view: 'sales', p_periods: 4 })
    expect(analyticsRequests.length).toBe(reads + 1)
    expect(seriesRequests).toHaveLength(1)
    expect(errors).toEqual([])
  })
}

test('a failed analytics read remains retryable when grouping changes', async ({ page }) => {
  await page.goto('sign-in')
  await page.getByLabel('Username or email', { exact: true }).fill('admin.kalyani')
  await page.getByLabel('Password').fill('shawarmania-local')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).not.toHaveURL(/\/sign-in$/)
  await page.route('**/rest/v1/rpc/sales_analytics', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Synthetic outage' }),
    }),
  )
  await page.goto('admin/analytics/sales')
  await expect(page.getByRole('alert')).toHaveText('Could not load analytics. Please try again.')
  await page.getByRole('button', { name: 'Group by: Day' }).click()
  await page.getByRole('button', { name: 'Week', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible()
  await page.unroute('**/rest/v1/rpc/sales_analytics')
  // Re-selecting the same range also retries; it must not hide the error and
  // leave a loading placeholder waiting for a date change that never happened.
  await page.getByRole('button', { name: 'Last 7 days' }).click()
  await expect(page.getByRole('button', { name: 'Group by: Week' })).toBeVisible()
  await expect(page.getByTestId('sales-trend-card')).toBeVisible()
})
