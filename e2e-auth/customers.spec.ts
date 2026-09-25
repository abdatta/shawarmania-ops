import { expect, test, type Page } from '@playwright/test'

/**
 * The Customers surface against the real database (a-gold-member-is-a-label).
 *
 * The boundary itself is proved in pgTAP and the REST probes; this proves the
 * screen reads and writes through it — that the owner finds, opens and makes
 * somebody gold on a phone, and that a manager meets a shared customer as
 * read-only because the database said so, not because the demo did.
 *
 * The seed's `Test Customer (Synthetic)` has bills at both outlets: a regular
 * for the owner, and a shared customer for the Kalyani manager.
 */

const SHARED = 'Test Customer (Synthetic)'

test.use({ viewport: { width: 390, height: 844 } })

async function signIn(page: Page, username: string) {
  await page.goto('sign-in')
  await page.getByLabel('Username or email', { exact: true }).fill(username)
  await page.getByLabel('Password').fill('shawarmania-local')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible()
}

async function openFromRegulars(page: Page, name: string) {
  const regulars = page.getByTestId('customer-list-regulars')
  await regulars.getByRole('button', { name: new RegExp(name.replace(/[()]/g, '\\$&')) }).click()
  return page.getByTestId('customer-card')
}

test('the owner finds a regular, and makes them gold and back', async ({ page }) => {
  await signIn(page, 'owner')
  await page.goto('owner/customers')

  // Regulars first, read from bills — the seed's shared customer is one.
  await expect(page.getByTestId('tab-regulars')).toHaveAttribute('aria-pressed', 'true')
  const card = await openFromRegulars(page, SHARED)
  await expect(card.getByTestId('customer-card-figures')).toContainText('Spent')
  await expect(card.getByTestId('customer-card-membership')).toContainText('Not a gold member')

  await card.getByRole('button', { name: 'Make gold member' }).click()
  await page.getByRole('button', { name: 'Make gold member', exact: true }).last().click()
  await expect(card.getByTestId('customer-card-membership')).toContainText('Gold member since')

  await card.getByRole('button', { name: 'Close' }).click()
  await page.getByTestId('tab-members').click()
  await expect(page.getByTestId('customer-list-members')).toContainText(SHARED)

  // Put it back, so the shared stack reads as the seed left it.
  await page
    .getByTestId('customer-list-members')
    .getByRole('button', { name: /Synthetic/ })
    .click()
  await page
    .getByTestId('customer-card')
    .getByRole('button', { name: 'Remove gold membership' })
    .click()
  await page.getByRole('button', { name: 'Remove gold', exact: true }).click()
  await expect(
    page.getByTestId('customer-card').getByTestId('customer-card-membership'),
  ).toContainText('Not a gold member')
})

test('the owner searches by part of a name and sees the match in bold', async ({ page }) => {
  await signIn(page, 'owner')
  await page.goto('owner/customers')
  await page.getByTestId('customer-search').fill('synthetic')
  const result = page.getByTestId('customer-search-result')
  await expect(result).toContainText(SHARED)
  await expect(result.locator('[data-match]').first()).toHaveText('Synthetic')
  // The lists step aside while a search is on screen.
  await expect(page.getByTestId('customer-tabs')).toHaveCount(0)
})

test('a manager meets a customer another outlet also serves as read-only', async ({ page }) => {
  await signIn(page, 'admin.kalyani')
  await page.goto('admin/customers')

  const card = await openFromRegulars(page, SHARED)
  await expect(card.getByTestId('customer-card-read-only')).toContainText('another outlet')
  await expect(card.getByRole('button', { name: 'Correct the name' })).toHaveCount(0)
  await expect(card.getByRole('button', { name: 'Make gold member' })).toHaveCount(0)
  await expect(card.getByTestId('customer-card-figures')).toContainText('First visit here')
})
