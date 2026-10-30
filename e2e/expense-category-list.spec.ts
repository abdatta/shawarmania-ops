import { expect, test } from './test'

/**
 * An expense's category picked from the owners' list
 * (a-check-in-at-the-shop-approves-itself, design D11), against a production
 * build and a real browser. Runs only with every gate on, where
 * `expense-category-list` and the refreshed screens it depends on are on.
 *
 * baseURL carries the deployment sub-path, so every goto is relative.
 */

const LIST = { tag: '@cg-on:expense-category-list' }

test(
  'staff pick a tile, and Other will not save without what it was for',
  LIST,
  async ({ page }) => {
    await page.goto('demo/staff/ledger/expenses')
    await page.getByTestId('add-ledger-expense').click()
    const sheet = page.getByRole('dialog', { name: 'Add expense' })
    const tiles = sheet.getByRole('radio')
    await expect(tiles).toHaveText([
      'Chicken',
      'Raw Materials',
      'Gas',
      'Staff Food',
      'Transport',
      'Other',
    ])
    await expect(sheet.getByTestId('expense-category')).toHaveCount(0)

    await sheet.getByTestId('expense-amount').fill('120')
    await sheet.getByRole('radio', { name: 'Other' }).click()
    await expect(sheet.getByRole('radio', { name: 'Other' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await sheet.getByRole('button', { name: 'Record expense' }).click()
    await expect(sheet.getByText('Say what it was for.')).toBeVisible()

    await sheet.getByLabel('What was it for?').fill('Light bulbs')
    await sheet.getByRole('button', { name: 'Record expense' }).click()
    await expect(sheet).toHaveCount(0)
    const row = page.getByTestId('ledger-expense-list').getByRole('listitem').filter({
      hasText: 'Light bulbs',
    })
    await expect(row).toContainText('Other')
  },
)

test(
  'the owner reaches the list from Expenses, adds a choice, and staff see it',
  LIST,
  async ({ page }) => {
    await page.goto('demo/owner/ledger/expenses')
    await page.getByTestId('manage-categories').click()
    await expect(page.getByRole('heading', { name: 'Manage categories' })).toBeVisible()

    await page.getByTestId('add-category-choice').click()
    const sheet = page.getByRole('dialog', { name: 'Add category' })
    await sheet.getByTestId('category-choice-name').fill('Packaging')
    await sheet.getByRole('button', { name: 'Save' }).click()
    await expect(sheet).toHaveCount(0)
    await expect(page.getByTestId('category-choice-Packaging')).toBeVisible()

    await page.getByRole('button', { name: 'Back' }).click()
    await expect(page.getByRole('heading', { name: 'Expenses' })).toBeVisible()

    // The demo keeps its data across a role switch, so staff see the new tile.
    await page.getByRole('link', { name: 'Staff' }).click()
    await page.getByRole('link', { name: 'Expenses' }).first().click()
    await page.getByTestId('add-ledger-expense').click()
    await expect(
      page.getByRole('dialog', { name: 'Add expense' }).getByRole('radio', { name: 'Packaging' }),
    ).toBeVisible()
  },
)
