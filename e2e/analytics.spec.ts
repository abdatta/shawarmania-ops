import { expect, test } from '@playwright/test'

for (const theme of ['light', 'dark']) {
  test(`analytics pages work and reload in ${theme}`, async ({ page }, testInfo) => {
    if (testInfo.project.name === 'phone') await page.setViewportSize({ width: 390, height: 844 })
    const errors: string[] = []
    const backendRequests: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('request', (r) => {
      if (r.url().includes('/rest/v1/') || r.url().includes('/functions/v1/'))
        backendRequests.push(r.url())
    })
    await page.addInitScript((t) => localStorage.setItem('shawarmania.theme', t), theme)
    await page.goto('demo/owner/analytics/items')
    await expect(page.getByRole('heading', { name: 'Items', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Dishes', exact: true })).toBeVisible()
    await expect(page.getByTestId('demo-banner')).toBeVisible()
    await expect(page.getByTestId('item-boards')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Show all|Show fewer/i })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Last 1 day', exact: true })).toHaveText('1d')
    await expect(page.getByRole('button', { name: 'Last 7 days' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(page.getByRole('button', { name: 'Last 30 days' })).toHaveText('30d')
    await expect(page.getByRole('heading', { name: /Ideas|Browsing/ })).toHaveCount(0)
    const rankings = page.getByRole('region', { name: 'Dish rankings' })
    await expect(rankings.getByTestId('dish-row')).toHaveCount(12)
    const height = (await rankings.boundingBox())!.height
    expect(height).toBe(320)
    const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight)
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
    expect(await rankings.getByTestId('dish-row').count()).toBeGreaterThan(50)
    expect((await rankings.boundingBox())!.height).toBe(height)
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(pageHeight)
    const units = await rankings
      .getByTestId('dish-row')
      .evaluateAll((rows) => rows.map((row) => Number(row.getAttribute('data-units'))))
    expect(units).toEqual([...units].sort((a, b) => b - a))
    await rankings.evaluate((el) => {
      el.scrollTop = 0
    })
    await expect(page.getByText('Counter revenue', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Average counter bill', { exact: true })).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
    await page.screenshot({ path: testInfo.outputPath(`items-${theme}.png`) })
    await page.getByRole('button', { name: 'Compare', exact: true }).click()
    const picker = page.getByRole('dialog', { name: 'Compare dishes' })
    await expect(picker.getByRole('checkbox', { checked: false }).first()).toBeDisabled()
    await picker.getByRole('checkbox', { checked: true }).nth(1).uncheck()
    await expect(picker.getByRole('button', { name: 'Compare 1/2' })).toBeDisabled()
    await picker.getByLabel('Find comparison dish').fill('Mayonnaise Chicken Shawarma')
    await picker.getByRole('checkbox', { name: /^Mayonnaise Chicken Shawarma \d+$/ }).check()
    await picker.getByLabel('Find comparison dish').fill('')
    const chosen = picker.getByRole('checkbox', { checked: true })
    await expect(chosen).toHaveCount(2)
    const labels = await chosen.evaluateAll((inputs) =>
      inputs.map((input) => input.closest('label')!.querySelector('span')!.textContent),
    )
    await picker.getByRole('button', { name: 'Compare 2/2' }).click()
    const comparison = page.getByTestId('dish-comparison')
    for (const label of labels)
      await expect(comparison.getByText(label!, { exact: true })).toBeVisible()
    await expect(comparison.locator('[aria-label$="units sold"]')).toHaveCount(2)
    await expect(comparison.getByText('Units sold', { exact: true })).toBeVisible()
    await expect(comparison.getByText('Previous-period units', { exact: true })).toBeVisible()
    await comparison.scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath(`comparison-${theme}.png`) })
    await comparison.getByRole('button', { name: 'Clear', exact: true }).click()
    await page.getByRole('button', { name: 'Worst', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Worst', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(rankings.getByTestId('dish-row')).toHaveCount(12)
    expect(await rankings.evaluate((el) => el.scrollTop)).toBe(0)
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
    await page.getByRole('link', { name: 'Sales', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Days', exact: true })).toBeVisible()
    const list = page.getByRole('region', { name: 'Sales periods' })
    await expect(list.getByTestId('period-row')).toHaveCount(7)
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(0)
    await expect(page.getByRole('button', { name: 'Measure: Revenue' })).toBeVisible()
    await expect(page.getByRole('button', { name: /Revenue source/ })).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath('sales-' + theme + '.png') })
    const trend = page.getByTestId('sales-trend')
    const chart = trend.getByRole('group')
    await chart.focus()
    await chart.press('Home')
    await expect(trend.getByTestId('chart-details')).toContainText('₹')
    await expect(trend.getByTestId('chart-details')).not.toContainText('Now')
    await chart.press('End')
    await expect(trend.getByTestId('chart-details')).toBeVisible()
    await page.getByRole('button', { name: 'Compare periods: 2 periods' }).click()
    await page.getByRole('button', { name: '4 periods', exact: true }).click()
    for (const id of ['sales-trend', 'sales-weekdays', 'sales-hours'])
      await expect(page.getByTestId(id).getByTestId('chart-series')).toHaveCount(4)
    await expect(page.getByTestId('sales-hours').locator('pattern')).toHaveCount(0)
    const fills = await page
      .getByTestId('sales-hours')
      .getByTestId('chart-series')
      .evaluateAll((groups) =>
        groups.map((group) => group.querySelector('rect')!.getAttribute('fill')),
      )
    expect(new Set(fills).size).toBe(4)
    expect(fills.every((fill) => fill && !fill.startsWith('url('))).toBe(true)
    for (const metric of ['Orders', 'AOV', 'Revenue']) {
      await page.getByRole('button', { name: /^Measure:/ }).click()
      await page
        .getByRole('dialog', { name: 'Measure' })
        .getByRole('button', { name: metric, exact: true })
        .click()
      await expect(page.getByRole('heading', { name: metric, exact: true })).toBeVisible()
      const weekdayTitle =
        metric === 'AOV' ? 'Average bill by weekday' : `Daily average ${metric.toLowerCase()}`
      const hourlyTitle =
        metric === 'AOV' ? 'Average bill by hour' : `Hourly average ${metric.toLowerCase()}`
      await expect(page.getByRole('heading', { name: weekdayTitle, exact: true })).toBeVisible()
      await expect(page.getByRole('heading', { name: hourlyTitle, exact: true })).toBeVisible()
      await expect(page.getByTestId('sales-weekdays').getByRole('group')).toHaveAttribute(
        'aria-label',
        new RegExp(weekdayTitle + ' chart'),
      )
      await expect(page.getByTestId('sales-hours').getByRole('group')).toHaveAttribute(
        'aria-label',
        new RegExp(hourlyTitle + ' chart'),
      )
    }
    await page.getByRole('button', { name: 'Last 30 days' }).click()
    const selectedRange = new URL(page.url())
    expect(
      (Date.parse(selectedRange.searchParams.get('to')!) -
        Date.parse(selectedRange.searchParams.get('from')!)) /
        86400000 +
        1,
    ).toBe(30)
    await expect(list.getByTestId('period-row')).toHaveCount(12)
    expect((await list.boundingBox())!.height).toBe(320)
    await page.getByRole('button', { name: 'Group by: Day' }).click()
    await page.getByRole('button', { name: 'Week', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Weeks', exact: true })).toBeVisible()
    await page.getByText('Table & export', { exact: true }).click()
    const table = page.getByRole('table')
    await expect(table.locator('thead th')).toHaveCount(5)
    await expect(trend.getByTestId('chart-point')).toHaveCount(
      await table.locator('tbody tr').count(),
    )
    const firstValue = await table.locator('tbody tr').first().locator('td').first().textContent()
    await chart.focus()
    await chart.press('Home')
    await expect(trend.getByTestId('chart-details')).toContainText(firstValue!)
    await page.reload()
    await expect(page.getByRole('button', { name: 'Group by: Week' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Compare periods: 4 periods' })).toBeVisible()
    await page.getByRole('button', { name: 'Group by: Week' }).click()
    await page.getByRole('button', { name: 'Hour', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Hours', exact: true }).first()).toBeVisible()
    await page.getByText('Table & export', { exact: true }).click()
    await expect(trend.getByTestId('chart-point')).toHaveCount(
      await table.locator('tbody tr').count(),
    )
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export CSV' }).click()
    expect((await download).suggestedFilename()).toBe('sales-trends.csv')
    await page.getByRole('button', { name: 'Last 1 day', exact: true }).click()
    await expect(trend.getByTestId('chart-point')).toHaveCount(24)
    const point = trend.getByTestId('chart-point').first()
    await chart.scrollIntoViewIfNeeded()
    const pointBounds = (await point.boundingBox())!
    const chartBounds = (await chart.boundingBox())!
    const position = {
      x: pointBounds.x + pointBounds.width / 2 - chartBounds.x,
      y: pointBounds.y + pointBounds.height / 2 - chartBounds.y,
    }
    // Inspect the visible chart at this point; earlier series may overlap it.
    await chart.hover({ position })
    await expect(trend.getByTestId('chart-details')).toBeVisible()
    await expect(trend.getByTestId('chart-details')).toContainText('00:00')
    await chart.click({ position })
    await expect(trend.getByTestId('chart-details')).toContainText('₹')
    await chart.tap({ position })
    await expect(trend.getByTestId('chart-details')).toContainText('₹')
    const hourChart = page.getByTestId('sales-hours').getByRole('group')
    const hourBars = page.getByTestId('sales-hours').getByTestId('chart-column')
    expect(await hourBars.count()).toBeGreaterThan(0)
    expect(await hourBars.count()).toBeLessThanOrEqual(24)
    const firstHourLabel = (await hourBars.first().textContent())!.match(/\d{2}:00/)![0]
    const soldHour = page
      .getByTestId('sales-hours')
      .locator('[data-testid="chart-column"]:not([height="0"])')
      .first()
    const hourLabel = (await soldHour.textContent())!.match(/\d{2}:00/)![0]
    await soldHour.hover()
    await expect(page.getByTestId('sales-hours').getByTestId('chart-details')).toContainText(
      hourLabel,
    )
    await soldHour.tap()
    await expect(page.getByTestId('sales-hours').getByTestId('chart-details')).toContainText(
      hourLabel,
    )
    await hourChart.focus()
    await hourChart.press('Home')
    await expect(page.getByTestId('sales-hours').getByTestId('chart-details')).toContainText(
      firstHourLabel,
    )
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
    await page.getByRole('button', { name: 'Choose dates' }).click()
    await page.getByTestId('analytics-from-day-picker').fill('2020-01-01')
    await page.getByTestId('analytics-to-day-picker').fill('2020-01-07')
    await page.getByRole('button', { name: 'Apply dates' }).click()
    await expect(
      page.getByRole('heading', { name: 'No settled sales in this period' }),
    ).toBeVisible()
    await expect(page.getByTestId('sales-hours').getByTestId('chart-column')).toHaveCount(24)
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
