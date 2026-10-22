import { expect, test } from './test'
import { OUTLET_KALYANI_ID as KAL } from '../src/data-access/mock/fixtures/outlets'

/**
 * One Revenue in the demo (revenue-reads-the-same-everywhere): Overview, the
 * Ledger and Analytics give one month, and Overview no longer qualifies it.
 */
const rupees = (text: string) => Number(text.replace(/[^\d.-]/g, '').split('.')[0])

test('Overview, the Ledger month and Analytics Month show one revenue', async ({ page }) => {
  await page.goto('demo/owner')
  const card = page.getByTestId(`outlet-card-${KAL}`)
  await expect(page.getByText(/Month to date/)).toBeVisible()
  const overview = rupees(await page.getByTestId(`revenue-${KAL}`).innerText())
  expect(overview).toBeGreaterThan(0)
  await expect(card.getByText(/Delivery data incomplete|Commission pending/)).toHaveCount(0)
  await expect(page.getByTestId(`comparison-${KAL}`)).toContainText(/vs \d+–\d+|No sales/)

  await page.getByTestId(`revenue-${KAL}`).click()
  const ledger = rupees(await page.getByTestId('month-revenue-net').innerText())
  expect(ledger).toBe(overview)
  await expect(page.getByTestId('month-revenue-basis')).toBeVisible()

  await page.goto(`demo/owner/analytics/sales?outlet=${KAL}`)
  await page.getByRole('button', { name: 'This month' }).click()
  await expect(page.getByTestId('sales-trend-compared')).toContainText(/^vs ₹/)
  const analytics = rupees(await page.getByTestId('sales-trend-value').innerText())
  expect(analytics).toBe(overview)
})

test('Overview today opens Billing history, and Month steps a calendar month at a time', async ({
  page,
}) => {
  await page.goto('demo/owner')
  await page
    .getByTestId(`outlet-card-${KAL}`)
    .getByRole('link', { name: /Today's revenue/ })
    .click()
  await expect(page).toHaveURL(new RegExp(`billing-history\\?outlet=${KAL}$`))
  await expect(page.getByRole('heading', { name: 'Billing history' })).toBeVisible()

  await page.goto(`demo/owner/analytics/sales?outlet=${KAL}`)
  await expect(page.getByRole('button', { name: 'Last 30 days' })).toHaveCount(0)
  await page.getByRole('button', { name: 'This month' }).click()
  await page.getByRole('button', { name: 'Previous period' }).click()
  await expect(page).toHaveURL(/from=\d{4}-\d{2}-01&to=\d{4}-\d{2}-(28|29|30|31)/)
  await expect(page).toHaveURL(/align=month/)
})
