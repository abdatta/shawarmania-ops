import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

import { LOCAL_ANON_KEY, OUTLET_KALYANI, PASSWORD, SUPABASE_URL } from './tills'

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
 *
 * Since a-regular-earns-points-and-gold (#62) the page reads one outlet, so each
 * test opens it on Kalyani by address; and gold is an outlet's switch, so the
 * gold round trip turns Kalyani's on for its length and off after, as the seed
 * has it.
 */

const CUSTOMERS_AT_KALYANI = (role: 'owner' | 'admin') =>
  `${role}/customers?outlet=${OUTLET_KALYANI}`

async function setKalyaniGold(request: APIRequestContext, on: boolean) {
  const signIn = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: LOCAL_ANON_KEY },
    data: { email: 'owner@login.shawarmania.invalid', password: PASSWORD },
  })
  expect(signIn.ok(), 'the owner could not sign in').toBe(true)
  const { access_token: token } = (await signIn.json()) as { access_token: string }
  const response = await request.post(`${SUPABASE_URL}/rest/v1/rpc/set_outlet_loyalty_settings`, {
    headers: { apikey: LOCAL_ANON_KEY, authorization: `Bearer ${token}` },
    data: {
      p_outlet: OUTLET_KALYANI,
      p_points_enabled: false,
      p_points_earn_per_block: null,
      p_points_earn_block_paise: null,
      p_points_use_cap_bp: null,
      p_gold_enabled: on,
      p_gold_earn_multiplier_x100: 100,
      p_points_gold_use_cap_bp: null,
      p_gold_duration_months: 6,
      p_gold_counter_grant: false,
      p_gold_threshold_paise: null,
    },
  })
  expect(response.ok(), `set_outlet_loyalty_settings failed: ${await response.text()}`).toBe(true)
}

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

test('the owner finds a regular, and makes them gold and back', async ({ page, request }) => {
  await setKalyaniGold(request, true)
  await signIn(page, 'owner')
  await page.goto(CUSTOMERS_AT_KALYANI('owner'))

  // Regulars first, read from bills — the seed's shared customer is one.
  await expect(page.getByTestId('tab-regulars')).toHaveAttribute('aria-pressed', 'true')
  const card = await openFromRegulars(page, SHARED)
  await expect(card.getByTestId('customer-card-figures')).toContainText('Spent')
  await expect(card.getByTestId('customer-card-membership')).toContainText('Not a gold member')

  await card.getByRole('button', { name: 'Upgrade to Gold' }).click()
  await page.getByRole('button', { name: 'Upgrade to Gold', exact: true }).last().click()
  // Gold ends on the date its grant stored (#62).
  await expect(card.getByTestId('customer-card-membership')).toContainText('Gold until')

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
  await setKalyaniGold(request, false)
})

test('the owner searches by part of a name and sees the match in bold', async ({ page }) => {
  await signIn(page, 'owner')
  await page.goto(CUSTOMERS_AT_KALYANI('owner'))
  await page.getByTestId('customer-search').fill('synthetic')
  const result = page.getByTestId('customer-search-result')
  await expect(result).toContainText(SHARED)
  await expect(result.locator('[data-match]').first()).toHaveText('Synthetic')
  // The lists step aside while a search is on screen.
  await expect(page.getByTestId('customer-tabs')).toHaveCount(0)
})

test('a manager meets a customer another outlet also serves as read-only', async ({ page }) => {
  await signIn(page, 'admin.kalyani')
  await page.goto(CUSTOMERS_AT_KALYANI('admin'))

  const card = await openFromRegulars(page, SHARED)
  await expect(card.getByTestId('customer-card-read-only')).toContainText('another outlet')
  await expect(card.getByRole('button', { name: 'Correct the name' })).toHaveCount(0)
  await expect(card.getByTestId('customer-card-figures')).toContainText('First visit here')
})
