import { expect, test } from './test'

/**
 * One Revenue over the real transport (revenue-reads-the-same-everywhere):
 * with the gate on, Analytics reads `sales_analytics_v2` and its series v2,
 * Month asks for month-aligned windows cut at the server's now, Overview reads
 * its month and today without sending a date, and a failed read stays
 * retryable. The off path's reads are pinned by `analytics.spec.ts`.
 */
async function signIn(page: import('@playwright/test').Page, username: string) {
  await page.goto('sign-in')
  await page.getByLabel('Username or email', { exact: true }).fill(username)
  await page.getByLabel('Password').fill('shawarmania-local')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).not.toHaveURL(/\/sign-in$/)
}

test(
  'Analytics reads the v2 functions, and Month asks for aligned, cut windows',
  { tag: '@cg-on:one-revenue' },
  async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await signIn(page, 'owner')

    const items = page.waitForResponse(
      (r) =>
        r.url().endsWith('/rpc/sales_analytics_v2') &&
        r.request().postDataJSON()?.p_view === 'items',
    )
    const series = page.waitForResponse((r) => r.url().endsWith('/rpc/sales_analytics_series_v2'))
    await page.goto('owner/analytics/items?from=2020-01-01&to=2020-01-07')
    expect((await items).status()).toBe(200)
    const chart = await (await series).json()
    expect(chart.units).toHaveLength(14)
    expect(chart.totals).toHaveLength(2)
    await expect(page.getByTestId('items-trend-compared')).toContainText('vs 0')

    const sales = page.waitForResponse(
      (r) =>
        r.url().endsWith('/rpc/sales_analytics_v2') &&
        r.request().postDataJSON()?.p_view === 'sales',
    )
    await page.goto('owner/analytics/sales?from=2020-01-01&to=2020-01-07')
    const salesRead = await sales
    const data = await salesRead.json()
    expect(data.days).toHaveLength(14)
    expect(data.totals).toHaveLength(2)
    // A past range is never cut.
    expect(salesRead.request().postDataJSON()).toMatchObject({ p_view: 'sales', p_align: 'equal' })
    expect(salesRead.request().postDataJSON()).not.toHaveProperty('p_cut')

    // Waits for the Month read itself: a re-read of the earlier range can land
    // first on a slow runner.
    const month = page.waitForResponse(
      (r) =>
        r.url().endsWith('/rpc/sales_analytics_v2') &&
        r.request().postDataJSON()?.p_align === 'month',
    )
    await page.getByRole('button', { name: 'This month' }).click()
    const monthRead = await month
    expect(monthRead.status()).toBe(200)
    expect(monthRead.request().postDataJSON()).toMatchObject({
      p_view: 'sales',
      p_align: 'month',
      p_cut: 'now',
    })
    await expect(page.getByTestId('sales-trend-compared')).toContainText(/^vs /)
    expect(errors).toEqual([])
  },
)

test(
  'Overview reads its month and today from the server, with no date sent',
  { tag: '@cg-on:one-revenue' },
  async ({ page }) => {
    // Listening before sign-in, which lands on Overview: a reload after it would
    // race the read the landing already made.
    const bodies: Record<string, unknown>[] = []
    page.on('request', (r) => {
      if (/\/rpc\/overview_(month|today)$/.test(r.url())) bodies.push(r.postDataJSON())
    })
    const month = page.waitForResponse(
      (r) => r.url().endsWith('/rpc/overview_month') && r.status() === 200,
    )
    await signIn(page, 'owner')
    const figures = await (await month).json()
    expect(figures.expensesPaise).toBe(figures.recordedExpensesPaise + figures.commissionPaise)
    await expect(page.getByText(/Month to date/)).toBeVisible()
    await expect(page.getByText(/Delivery data incomplete|Commission pending/)).toHaveCount(0)
    expect(bodies.length).toBeGreaterThan(0)
    for (const body of bodies) expect(Object.keys(body)).toEqual(['p_outlet_id'])
  },
)

test('a failed v2 read remains retryable', { tag: '@cg-on:one-revenue' }, async ({ page }) => {
  await signIn(page, 'admin.kalyani')
  await page.route('**/rest/v1/rpc/sales_analytics_v2', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Synthetic outage' }),
    }),
  )
  await page.goto('admin/analytics/sales')
  await expect(page.getByRole('alert')).toHaveText('Could not load analytics. Please try again.')
  await page.unroute('**/rest/v1/rpc/sales_analytics_v2')
  await page.getByRole('button', { name: 'Retry' }).click()
  await expect(page.getByTestId('sales-trend-card')).toBeVisible()
})

const KAL = '00000000-0000-4000-a000-000000000001'
const KPA = '00000000-0000-4000-a000-000000000002'

for (const width of [360, 390]) {
  for (const theme of ['light', 'dark']) {
    test(
      `six-digit One Revenue amounts remain bold and fit at ${width}px in ${theme}`,
      { tag: '@cg-on:one-revenue' },
      async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height: 844 })
        // Deliberately extreme, deterministic read responses. No financial writes.
        await page.route('**/rest/v1/rpc/overview_*', async (route) => {
          const method = new URL(route.request().url()).pathname.split('/').at(-1)
          const kal = route.request().postDataJSON().p_outlet_id === KAL
          const body =
            method === 'overview_today'
              ? { cashPaise: 55555555, upiPaise: 44444444, deliveryPaise: 12345678 }
              : method === 'overview_drawer'
                ? { expectedPaise: 99999999, leftPaise: 88888888, spentPaise: 77777777 }
                : {
                    month: '2026-10',
                    from: '2026-10-01',
                    through: '2026-10-15',
                    revenuePaise: kal ? 50000000 : 199999999,
                    cashPaise: 0,
                    upiPaise: 0,
                    deliveryPaise: 0,
                    commissionPaise: 0,
                    waitingDays: 0,
                    recordedExpensesPaise: kal ? 149999999 : 0,
                    expensesPaise: kal ? 149999999 : 0,
                    profitPaise: kal ? -99999999 : 199999999,
                    hasSales: true,
                    previous: {
                      from: '2026-09-01',
                      through: '2026-09-15',
                      cutAt: '2026-09-15T10:10:00.000Z',
                      revenuePaise: 99999999,
                      hasSales: true,
                    },
                  }
          await route.fulfill({ json: body })
        })
        await page.goto('sign-in')
        await page.evaluate((value) => localStorage.setItem('shawarmania.theme', value), theme)
        await page.reload()
        await page.getByLabel('Username or email', { exact: true }).fill('owner')
        await page.getByLabel('Password').fill('shawarmania-local')
        await page.getByRole('button', { name: 'Sign in' }).click()
        const card = page.getByTestId(`outlet-card-${KAL}`)
        await expect(card.getByTestId(`profit-${KAL}`)).toHaveText('-₹9,99,999')
        for (const metric of ['sales', 'cash', 'revenue', 'profit']) {
          const number = card.getByTestId(`${metric}-${KAL}`)
          expect(
            await number.evaluate((node) => Number(getComputedStyle(node).fontWeight)),
          ).toBeGreaterThanOrEqual(700)
          expect(
            await number.evaluate(
              (node) =>
                node.getBoundingClientRect().right <=
                node.parentElement!.nextElementSibling!.getBoundingClientRect().left,
            ),
          ).toBe(true)
        }
        await page.screenshot({
          path: testInfo.outputPath('one-revenue-extreme.png'),
          fullPage: true,
        })
        // Every subtext stays inside its cell; today's tenders may take a
        // second line only where even the icons cannot fit one.
        const captions = card.getByTestId('metric-subtext')
        await expect(captions).toHaveCount(4)
        expect(
          await captions.evaluateAll((nodes) =>
            nodes.every((node) => node.scrollWidth <= node.clientWidth + 1),
          ),
        ).toBe(true)
        const tall = await captions.evaluateAll(
          (nodes) =>
            nodes.filter(
              (node) =>
                node.getBoundingClientRect().height >
                parseFloat(getComputedStyle(node).lineHeight) + 1,
            ).length,
        )
        expect(tall).toBeLessThanOrEqual(1)
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      },
    )
  }
}

test(
  'One Revenue Overview arrives independently and fits phone and tablet',
  { tag: '@cg-on:one-revenue' },
  async ({ page }) => {
    let release!: () => void
    const monthly = new Promise<void>((resolve) => {
      release = resolve
    })
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route('**/rest/v1/rpc/overview_month', async (route) => {
      await monthly
      await route.continue()
    })
    try {
      await signIn(page, 'owner')
      await expect(page.getByTestId(`sales-${KAL}`)).toBeVisible()
      await expect(page.getByTestId(`revenue-${KAL}`)).toHaveCount(0)
      await expect(page.getByTestId(`outlet-card-${KPA}`)).toBeVisible()
    } finally {
      release()
    }
    await expect(page.getByTestId(`revenue-${KAL}`)).toBeVisible()
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 1080, height: 810 },
    ]) {
      await page.setViewportSize(viewport)
      await page.reload()
      await expect(page.getByTestId(`revenue-${KAL}`)).toBeVisible()
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(1)
    }
    expect(errors).toEqual([])
  },
)

test(
  'a manager’s One Revenue Overview holds only their outlet and opens its month',
  { tag: '@cg-on:one-revenue' },
  async ({ page }) => {
    await signIn(page, 'admin.kalyani')
    await expect(page.getByTestId(`sales-${KAL}`)).toBeVisible()
    await expect(page.locator('[data-testid^="outlet-card-"]')).toHaveCount(1)
    await expect(page.getByTestId(`outlet-card-${KPA}`)).toHaveCount(0)
    await page.getByTestId(`revenue-${KAL}`).click()
    await expect(page).toHaveURL(new RegExp(`ledger[?]outlet=${KAL}&view=month&month=`))
    await expect(page.getByTestId('month-revenue-basis')).toBeVisible()
  },
)
