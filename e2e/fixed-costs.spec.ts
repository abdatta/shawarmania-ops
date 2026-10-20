import type { Page } from '@playwright/test'

import { expect, test } from './test'
import { OUTLET_KALYANI_ID as KAL } from '../src/data-access/mock/fixtures/outlets'

/**
 * Fixed costs in the demo (fixed-costs-are-spread-over-the-month): the Fixed
 * tab of Expenses, paying in parts and undoing, last month's salary paid now
 * and counted in last month, Needs attention, and, with `pro-rata-pnl` on, the
 * figures that read them. The tab is not behind the gate, so the walk through
 * it runs both ways. Each test moves inside the app after its first page: the
 * demo keeps its data in the page, so a reload starts it again.
 */
const FIXED = `demo/owner/ledger/fixed-costs?outlet=${KAL}`

function row(page: Page, name: string) {
  return page.getByTestId('fixed-cost-list').getByRole('row').filter({ hasText: name })
}

async function pay(page: Page, amount?: string, reason?: string) {
  if (amount !== undefined) await page.getByTestId('fixed-cost-pay-amount').fill(amount)
  if (reason) await page.getByTestId(`pay-reason-${reason}`).click()
  await page.getByTestId('fixed-cost-paid-with').selectOption('other')
  await page.getByTestId('save-fixed-cost-payment').click()
  await expect(page.getByTestId('fixed-cost-recorded')).toBeVisible()
}

test('a fixed cost is added, paid in two parts, and a payment undone', async ({ page }) => {
  await page.goto(FIXED)
  await expect(page.getByTestId('expense-tab-fixed')).toHaveAttribute('aria-current', 'page')
  await page.getByRole('button', { name: 'Add a fixed cost' }).click()
  await page.getByTestId('fixed-cost-name').fill('Ravi')
  await page.getByTestId('fixed-cost-category').selectOption('salary')
  await page.getByTestId('fixed-cost-amount').fill('9000')
  // From the 1st of the outlet's month, so the month is the amount in full.
  const today = await page.getByTestId('fixed-cost-starts').inputValue()
  await page.getByTestId('fixed-cost-starts').fill(`${today.slice(0, 7)}-01`)
  await page.getByTestId('save-fixed-cost').click()
  await expect(row(page, 'Ravi')).toContainText('₹0 of ₹9,000 paid')

  // Part of it: less than due, so the sheet asks why.
  await page.getByRole('button', { name: 'Pay Ravi' }).click()
  await expect(page.getByTestId('fixed-cost-pay-amount')).toHaveValue('9000')
  await pay(page, '3000', 'advance-this')
  await expect(row(page, 'Ravi')).toContainText('₹3,000 of ₹9,000 paid')

  // The rest, exactly: nothing to ask.
  await page.getByRole('button', { name: 'Pay Ravi' }).click()
  await expect(page.getByTestId('fixed-cost-pay-amount')).toHaveValue('6000')
  await expect(page.getByTestId('fixed-cost-pay-reasons')).toHaveCount(0)
  await pay(page)
  await expect(row(page, 'Ravi')).toContainText('₹9,000 paid')

  // Undo the second payment on Ravi's page.
  await row(page, 'Ravi').getByText('Ravi').click()
  await page.getByRole('button', { name: /^Undo the ₹6,000 paid/ }).click()
  await expect(page.getByRole('dialog')).toContainText('withdraws the ₹6,000 paid')
  await page.getByRole('dialog').getByRole('button', { name: 'Undo' }).click()
  await expect(page.getByTestId('fixed-cost-payments')).not.toContainText('₹6,000')
  await expect(page.getByTestId('fixed-cost-left')).toContainText('₹6,000')
})

test('last month’s salary is paid now, counted in last month, and Needs attention clears', async ({
  page,
}) => {
  await page.goto('demo/owner')
  const attention = page.getByTestId('overview-attention-fixed-costs-unpaid')
  await expect(attention).toContainText(/Fixed costs: 1 unpaid from \w+/)
  await attention.click()
  await expect(page).toHaveURL(/ledger\/fixed-costs/)

  await expect(row(page, 'Priyanka')).toContainText('overdue from')
  await page.getByRole('button', { name: 'Pay Priyanka' }).click()
  // The overdue month, in full: its own month's salary, shown in that month.
  await expect(page.getByTestId('fixed-cost-pay-amount')).toHaveValue('3300')
  await expect(page.getByTestId('fixed-cost-shows-in')).toBeVisible()
  await pay(page)
  await expect(page.getByTestId('fixed-cost-recorded')).toContainText(/recorded on \d+ \w+/)

  await expect(row(page, 'Priyanka')).not.toContainText('overdue')
  // In the app, not a reload: the demo's data lives in the page.
  await page.getByRole('link', { name: 'Overview' }).first().click()
  await expect(page.getByTestId(`outlet-card-${KAL}`)).toBeVisible()
  await expect(page.getByTestId('overview-attention-fixed-costs-unpaid')).toHaveCount(0)
})

test(
  'Overview and the Ledger carry P&L (Pro-rata), and a payment carries the Fixed chip',
  { tag: '@cg-on:pro-rata-pnl' },
  async ({ page }) => {
    await page.goto('demo/owner')
    await expect(page.getByTestId(`outlet-card-${KAL}`)).toContainText(/P&L \(Pro-rata\)/)

    await page.goto(FIXED)
    await page.getByRole('button', { name: 'Pay Garbage' }).click()
    await pay(page)
    await page.getByTestId('fixed-cost-recorded-view').click()
    await expect(page.locator('[data-testid^="expense-fixed-"]').first()).toContainText('Fixed')

    await page.getByRole('link', { name: 'Ledger' }).first().click()
    await page.getByRole('button', { name: 'The month' }).click()
    await expect(page.getByTestId('month-pro-rata')).toBeVisible()
    await expect(page.getByTestId('month-fixed-costs')).toContainText('Garbage')
  },
)

test(
  'with pro-rata-pnl off, Overview and the Ledger read as before',
  { tag: '@cg-off:pro-rata-pnl' },
  async ({ page }) => {
    await page.goto('demo/owner')
    await expect(page.getByTestId(`outlet-card-${KAL}`)).toBeVisible()
    await expect(page.getByTestId(`outlet-card-${KAL}`)).not.toContainText('Pro-rata')
    await page.goto(`demo/owner/ledger?outlet=${KAL}&view=month`)
    await expect(page.getByTestId('month-expenses')).toBeVisible()
    await expect(page.getByTestId('month-pro-rata')).toHaveCount(0)
  },
)
