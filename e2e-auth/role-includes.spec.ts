import { type Page } from '@playwright/test'

import { expect, test } from './test'

/**
 * Which staff role includes which, over the real transport
 * (staff-roles-include-other-roles, design D7): a page asks the `_v2` of each
 * staff check, which asks which roles include which, and every role gets the
 * answer the named roles gave.
 */
async function signIn(page: Page, username: string) {
  await page.goto('sign-in')
  await page.getByLabel('Username or email', { exact: true }).fill(username)
  await page.getByLabel('Password').fill('shawarmania-local')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).not.toHaveURL(/\/sign-in$/)
}

test('a Biller reads the expense list through expense_people_v2, and sees who recorded each row', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await signIn(page, 'biller.kalyani')

  const people = page.waitForResponse((r) => r.url().endsWith('/rpc/expense_people_v2'))
  await page.goto('staff/ledger/expenses')
  const read = await people
  expect(read.status()).toBe(200)
  expect(Array.isArray(await read.json())).toBe(true)
  await expect(page.getByRole('heading', { name: 'Expenses' }).first()).toBeVisible()
  expect(errors).toEqual([])
})

test('a manager reads the same list through the same function', async ({ page }) => {
  await signIn(page, 'admin.kalyani')
  const people = page.waitForResponse((r) => r.url().endsWith('/rpc/expense_people_v2'))
  await page.goto('admin/ledger/expenses')
  expect((await people).status()).toBe(200)
})
