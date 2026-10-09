import { expect, test, type Page, type TestInfo } from '@playwright/test'

/** Theme, phone size, and the two things every Analytics walk must end without. */
async function openAnalytics(page: Page, testInfo: TestInfo, theme: string, path: string) {
  if (testInfo.project.name === 'phone') await page.setViewportSize({ width: 390, height: 844 })
  const errors: string[] = []
  const backendRequests: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('request', (r) => {
    if (r.url().includes('/rest/v1/') || r.url().includes('/functions/v1/'))
      backendRequests.push(r.url())
  })
  await page.addInitScript((t) => localStorage.setItem('shawarmania.theme', t), theme)
  await page.goto(path)
  await expect(page.getByTestId('demo-banner')).toBeVisible()
  return { errors, backendRequests }
}

async function chooseMeasure(page: Page, measure: string) {
  await page.getByRole('button', { name: /^Measure:/ }).click()
  await page
    .getByRole('dialog', { name: 'Measure' })
    .getByRole('button', { name: measure, exact: true })
    .click()
}

for (const theme of ['light', 'dark']) {
  test(`Items charts any dish or category against earlier periods in ${theme}`, async ({
    page,
  }, testInfo) => {
    const { errors, backendRequests } = await openAnalytics(
      page,
      testInfo,
      theme,
      'demo/owner/analytics/items',
    )
    await expect(page.getByRole('heading', { name: 'Items', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Last 7 days' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    // Head-to-head comparison is gone; the trend chart replaced it.
    await expect(page.getByTestId('dish-comparison')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Compare', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Group by: Day' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Measure: Units' })).toBeVisible()

    const card = page.getByTestId('items-trend-card')
    await expect(card.getByRole('button', { name: /^Charting All dishes/ })).toBeVisible()
    await expect(card.getByRole('heading', { name: 'Units sold' })).toBeVisible()
    await expect(page.getByTestId('items-trend').getByTestId('chart-series')).toHaveCount(2)
    await expect(page.getByTestId('items-trend').getByTestId('chart-point')).toHaveCount(7)
    const chart = page.getByTestId('items-trend').getByRole('group')
    await chart.focus()
    await chart.press('End')
    await expect(page.getByTestId('items-trend').getByTestId('chart-details')).toBeVisible()

    // Rankings: a fixed card that pages more dishes in as it scrolls.
    const rankings = page.getByRole('region', { name: 'Dish rankings' })
    await expect(rankings.getByTestId('dish-row')).toHaveCount(12)
    const height = (await rankings.boundingBox())!.height
    expect(height).toBe(320)
    const dishCount = Number(await rankings.getAttribute('data-total'))
    for (
      let batch = 0;
      batch < 10 && (await rankings.getByTestId('dish-row').count()) < dishCount;
      batch++
    ) {
      const before = await rankings.getByTestId('dish-row').count()
      await rankings.evaluate((el) => {
        el.scrollTop = el.scrollHeight
      })
      await expect.poll(() => rankings.getByTestId('dish-row').count()).toBeGreaterThan(before)
    }
    await expect(rankings.getByTestId('dish-row')).toHaveCount(dishCount)
    expect(dishCount).toBeGreaterThan(50)
    expect((await rankings.boundingBox())!.height).toBe(height)
    const units = await rankings
      .getByTestId('dish-row')
      .evaluateAll((rows) => rows.map((row) => Number(row.getAttribute('data-units'))))
    expect(units).toEqual([...units].sort((a, b) => b - a))
    await rankings.evaluate((el) => {
      el.scrollTop = 0
    })

    // Tapping a dish charts it, in the address so a reload keeps it.
    const top = rankings.getByTestId('dish-row').nth(1)
    const topUnits = await top.getAttribute('data-units')
    const topName = (await top.getAttribute('aria-label'))!.replace(/^Chart /, '')
    await top.click()
    await expect(page).toHaveURL(/[?&]dish=/)
    await expect(top).toHaveAttribute('aria-pressed', 'true')
    await expect(
      card.getByRole('button', { name: `Charting ${topName}. Choose what to chart` }),
    ).toBeVisible()
    await expect(page.getByTestId('items-trend-value')).toHaveText(topUnits!)

    // The same figures as a table: every day of both periods and the change.
    await card.getByRole('button', { name: 'Table', exact: true }).click()
    const table = page.getByTestId('items-trend-table')
    await expect(table.locator('tbody tr')).toHaveCount(7)
    await expect(table.locator('thead th')).toHaveCount(4)
    await page.screenshot({ path: testInfo.outputPath(`items-${theme}.png`) })
    await page.reload()
    await expect(page.getByTestId('items-trend-table')).toBeVisible()
    await expect(
      card.getByRole('button', { name: `Charting ${topName}. Choose what to chart` }),
    ).toBeVisible()
    await card.getByRole('button', { name: 'Chart', exact: true }).click()

    // Four periods and revenue: the chart reads its series again, the lists don't move.
    await page.getByRole('button', { name: 'Compare periods: 2 periods' }).click()
    await page.getByRole('button', { name: '4 periods', exact: true }).click()
    await expect(page.getByTestId('items-trend').getByTestId('chart-series')).toHaveCount(4)
    await chooseMeasure(page, 'Revenue')
    await expect(card.getByRole('heading', { name: 'Dish revenue' })).toBeVisible()
    await expect(page.getByTestId('items-trend-value')).toContainText('₹')

    // Categories carry their own change and chart the same way.
    const categories = page.getByTestId('category-row')
    expect(await categories.count()).toBeGreaterThan(5)
    await expect(page.getByText('Uncategorised', { exact: true })).toHaveCount(0)
    const category = (await categories.first().getAttribute('aria-label'))!.replace(/^Chart /, '')
    await categories.first().click()
    await expect(page).toHaveURL(/[?&]category=/)
    await expect(page).not.toHaveURL(/[?&]dish=/)
    await expect(
      card.getByRole('button', { name: `Charting ${category}. Choose what to chart` }),
    ).toBeVisible()

    // And through the picker, back to every dish.
    await card.getByRole('button', { name: /Choose what to chart/ }).click()
    const picker = page.getByRole('dialog', { name: 'Chart' })
    await expect(picker.getByRole('region', { name: 'Categories' })).toBeVisible()
    await picker.getByRole('button', { name: 'All dishes' }).click()
    await expect(page).not.toHaveURL(/[?&](dish|category)=/)
    await expect(card.getByRole('button', { name: /^Charting All dishes/ })).toBeVisible()

    await page.getByRole('button', { name: 'Worst', exact: true }).click()
    const worst = await rankings
      .getByTestId('dish-row')
      .evaluateAll((rows) => rows.map((row) => Number(row.getAttribute('data-units'))))
    expect(worst[0]).toBe(0)
    expect(worst).toEqual([...worst].sort((a, b) => a - b))
    for (const tab of ['Rising', 'Slow']) {
      await page.getByRole('button', { name: tab, exact: true }).click()
      const rows = await rankings.getByTestId('dish-row').evaluateAll((elements) =>
        elements.map((el) => ({
          units: Number(el.getAttribute('data-units')),
          previous: Number(el.getAttribute('data-previous-units')),
        })),
      )
      expect(rows.length).toBeGreaterThan(0)
      expect(
        rows.every(
          (row) =>
            row.previous > 0 &&
            (tab === 'Rising' ? row.units > row.previous : row.units < row.previous),
        ),
      ).toBe(true)
    }
    await page.getByLabel('Search dishes').fill('does-not-exist')
    await expect(page.getByText('No dishes match this filter.')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
    expect(errors).toEqual([])
    expect(backendRequests).toEqual([])
  })

  test(`Sales reads one trend as a chart or a table in ${theme}`, async ({ page }, testInfo) => {
    const { errors, backendRequests } = await openAnalytics(
      page,
      testInfo,
      theme,
      'demo/owner/analytics/sales',
    )
    const card = page.getByTestId('sales-trend-card')
    await expect(card.getByRole('heading', { name: 'Revenue', exact: true })).toBeVisible()
    // The Days list and the weekday card are gone: the table and the chart cover them.
    await expect(page.getByRole('heading', { name: 'Days', exact: true })).toHaveCount(0)
    await expect(page.getByTestId('sales-weekdays')).toHaveCount(0)
    await expect(page.getByText('Table & export')).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath(`sales-${theme}.png`) })
    const trend = page.getByTestId('sales-trend')
    const chart = trend.getByRole('group')
    await chart.focus()
    await chart.press('Home')
    await expect(trend.getByTestId('chart-details')).toContainText('₹')

    await page.getByRole('button', { name: 'Compare periods: 2 periods' }).click()
    await page.getByRole('button', { name: '4 periods', exact: true }).click()
    for (const id of ['sales-trend', 'sales-hours'])
      await expect(page.getByTestId(id).getByTestId('chart-series')).toHaveCount(4)
    const fills = await page
      .getByTestId('sales-hours')
      .getByTestId('chart-series')
      .evaluateAll((groups) =>
        groups.map((group) => group.querySelector('rect')!.getAttribute('fill')),
      )
    expect(new Set(fills).size).toBe(4)
    for (const metric of ['Orders', 'AOV', 'Revenue']) {
      await chooseMeasure(page, metric)
      await expect(card.getByRole('heading', { name: metric, exact: true })).toBeVisible()
      const hourlyTitle =
        metric === 'AOV' ? 'Average bill by hour' : `Hourly average ${metric.toLowerCase()}`
      await expect(page.getByRole('heading', { name: hourlyTitle, exact: true })).toBeVisible()
    }

    await page.getByRole('button', { name: 'Last 30 days' }).click()
    await page.getByRole('button', { name: 'Group by: Day' }).click()
    await page.getByRole('button', { name: 'Week', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Group by: Week' })).toBeVisible()
    // Thirty days from a Monday-week boundary is five or six weeks.
    await expect.poll(() => trend.getByTestId('chart-point').count()).toBeLessThan(7)
    const points = await trend.getByTestId('chart-point').count()
    await card.getByRole('button', { name: 'Table', exact: true }).click()
    const table = page.getByTestId('sales-trend-table')
    // A header for the bucket, one per period, and the change.
    await expect(table.locator('thead th')).toHaveCount(6)
    await expect(table.locator('tbody tr')).toHaveCount(points)
    await page.reload()
    await expect(page.getByRole('button', { name: 'Group by: Week' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Compare periods: 4 periods' })).toBeVisible()
    await expect(page.getByTestId('sales-trend-table')).toBeVisible()

    await page.getByRole('button', { name: 'Group by: Week' }).click()
    await page.getByRole('button', { name: 'Hour', exact: true }).click()
    await expect(table.locator('tbody tr')).toHaveCount(24)
    const download = page.waitForEvent('download')
    await card.getByRole('button', { name: 'Export CSV' }).click()
    expect((await download).suggestedFilename()).toBe('sales-trends.csv')
    await card.getByRole('button', { name: 'Chart', exact: true }).click()
    await page.getByRole('button', { name: 'Last 1 day', exact: true }).click()
    await expect(trend.getByTestId('chart-point')).toHaveCount(24)

    const hours = page.getByTestId('sales-hours')
    const soldHour = hours.locator('[data-testid="chart-column"]:not([height="0"])').first()
    const hourLabel = (await soldHour.textContent())!.match(/\d{2}:00/)![0]
    await soldHour.hover()
    await expect(hours.getByTestId('chart-details')).toContainText(hourLabel)
    await soldHour.tap()
    await expect(hours.getByTestId('chart-details')).toContainText(hourLabel)
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)

    await page.getByRole('button', { name: 'Choose dates' }).click()
    await page.getByTestId('analytics-from-day-picker').fill('2020-01-01')
    await page.getByTestId('analytics-to-day-picker').fill('2020-01-07')
    await page.getByRole('button', { name: 'Apply dates' }).click()
    await expect(
      page.getByRole('heading', { name: 'No settled sales in this period' }),
    ).toBeVisible()
    await expect(hours.getByTestId('chart-column')).toHaveCount(24)
    await page.getByRole('link', { name: 'Items', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Dishes', exact: true })).toBeVisible()
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(0)
    expect(errors).toEqual([])
    expect(backendRequests).toEqual([])
  })
}

test('analytics routes are absent for staff', async ({ page }) => {
  await page.goto('demo/staff/analytics/items')
  await expect(page.getByRole('heading', { name: 'Dishes', exact: true })).toHaveCount(0)
})

test('invalid deep-link dates can recover through the compact date picker', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('demo/owner/analytics/items?from=invalid&to=2026-02-31')
  await expect(page.getByRole('alert')).toBeVisible()
  await page.getByRole('button', { name: 'Choose dates' }).click()
  await page.getByRole('button', { name: 'Apply dates' }).click()
  await expect(page.getByRole('heading', { name: 'Dishes', exact: true })).toBeVisible()
  expect(errors).toEqual([])
})
