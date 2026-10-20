import type { APIRequestContext, Page } from '@playwright/test'

import { SAVED_ANSWERS_KEY } from '../src/change-gates/snapshot'
import { expect, test } from './test'
import { LOCAL_ANON_KEY, PASSWORD, SUPABASE_URL, serviceRoleKey } from './tills'

/**
 * Fixed costs over the real transport (fixed-costs-are-spread-over-the-month):
 * a fixed cost added and paid in part by the owner, its payment an expense the
 * Fixed chip marks; P&L (Pro-rata) read from the outlet's fixed costs, asked
 * beside `overview_month`; and the gate's round trip (design D10): turned off,
 * Overview asks `overview_month` alone and the payment is an ordinary expense;
 * turned back on, the chip and P&L (Pro-rata) return, charging only the unpaid
 * share. A manager is refused the other outlet's fixed costs, and a Biller
 * reads a cash payment as the cash expense it is, with no chip.
 *
 * Nothing here can be deleted, and the specs after this one share the stack, so
 * each test retires what it added: its payments undone, and the fixed cost moved
 * to last month at nothing and stopped there. Kalyani is left with no fixed cost
 * this month, nothing unpaid, and its drawer as it was.
 */

const KAL = '00000000-0000-4000-a000-000000000001'
const KPA = '00000000-0000-4000-a000-000000000002'

async function signIn(page: Page, username: string) {
  await page.goto('sign-in')
  await page.getByLabel('Username or email', { exact: true }).fill(username)
  await page.getByLabel('Password').fill('shawarmania-local')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).not.toHaveURL(/\/sign-in$/)
}

async function forceGate(enabled: boolean) {
  const key = serviceRoleKey()
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/change_gate_force`, {
    method: 'POST',
    headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      p_key: 'pro-rata-pnl',
      p_enabled: enabled,
      p_reason: 'auth browser tests, the pro-rata-pnl round trip',
    }),
  })
  if (!response.ok) throw new Error(`change_gate_force failed: ${response.status}`)
}

/** Boot the page as a phone that has heard the turn, as the update path's reload does. */
async function rebootWith(page: Page, enabled: boolean) {
  await page.evaluate(
    ({ key, enabled }) => {
      const saved = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, boolean>
      localStorage.setItem(key, JSON.stringify({ ...saved, 'pro-rata-pnl': enabled }))
    },
    { key: SAVED_ANSWERS_KEY, enabled },
  )
  await page.reload()
}

/** A name of its own each run: the local stack is shared, and nothing here is deleted. */
const unique = () => `Auth ${Date.now().toString(36)}`

async function ownerRpc(request: APIRequestContext) {
  const signedIn = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: LOCAL_ANON_KEY },
    data: { email: 'owner@login.shawarmania.invalid', password: PASSWORD },
  })
  expect(signedIn.ok()).toBe(true)
  const { access_token: token } = (await signedIn.json()) as { access_token: string }
  return async (name: string, body: Record<string, unknown>) => {
    const response = await request.post(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
      headers: { apikey: LOCAL_ANON_KEY, authorization: `Bearer ${token}` },
      data: body,
    })
    expect(response.ok(), `${name}: ${await response.text()}`).toBe(true)
    return response.status() === 204 ? null : ((await response.json()) as unknown)
  }
}

interface Listed {
  today: string
  costs: { id: string; name: string; category: string; payments: { id: string }[] }[]
}

/** Undo its payments, then move it to last month at nothing and stop it there. */
async function retire(request: APIRequestContext, names: string[]) {
  if (names.length === 0) return
  const rpc = await ownerRpc(request)
  const listed = (await rpc('fixed_costs_list', { p_outlet_id: KAL })) as Listed
  const [year, month] = listed.today.split('-').map(Number) as [number, number]
  const lastMonth = new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 10)
  const lastDay = new Date(Date.UTC(year, month - 1, 0)).toISOString().slice(0, 10)
  for (const cost of listed.costs.filter((c) => names.includes(c.name))) {
    for (const payment of cost.payments)
      await rpc('undo_fixed_cost_payment', { p_fixed_cost_id: cost.id, p_payment_id: payment.id })
    await rpc('update_fixed_cost', {
      p_fixed_cost_id: cost.id,
      p_name: cost.name,
      p_category: cost.category,
      p_starts_on: lastMonth,
      p_note: '',
    })
    await rpc('change_fixed_cost_amount', {
      p_fixed_cost_id: cost.id,
      p_from_month: lastMonth,
      p_amount_paise: 0,
    })
    await rpc('stop_fixed_cost', {
      p_fixed_cost_id: cost.id,
      p_stops_on: lastDay,
      p_clear_ahead: false,
    })
  }
}

const added: string[] = []
test.afterEach(async ({ request }) => {
  await retire(request, added.splice(0))
})

async function addAndPayPart(page: Page, name: string, isCash = false) {
  await page.goto(`owner/ledger/fixed-costs?outlet=${KAL}`)
  await page.getByRole('button', { name: 'Add a fixed cost' }).click()
  await page.getByTestId('fixed-cost-name').fill(name)
  await page.getByTestId('fixed-cost-category').selectOption('salary')
  await page.getByTestId('fixed-cost-amount').fill('9000')
  const today = await page.getByTestId('fixed-cost-starts').inputValue()
  await page.getByTestId('fixed-cost-starts').fill(`${today.slice(0, 7)}-01`)
  await page.getByTestId('save-fixed-cost').click()
  const row = page.getByTestId('fixed-cost-list').getByRole('row').filter({ hasText: name })
  await expect(row).toContainText('₹0 of ₹9,000 paid')

  await page.getByRole('button', { name: `Pay ${name}` }).click()
  await page.getByTestId('fixed-cost-pay-amount').fill('3000')
  await page.getByTestId('pay-reason-advance-this').click()
  await page.getByTestId('fixed-cost-paid-with').selectOption(isCash ? 'cash' : 'other')
  await page.getByTestId('save-fixed-cost-payment').click()
  await expect(page.getByTestId('fixed-cost-recorded')).toBeVisible()
  await expect(row).toContainText('₹3,000 of ₹9,000 paid')
  return row
}

test(
  'P&L (Pro-rata) and the Fixed chip go with the gate and come back with it',
  { tag: '@cg-round-trip:pro-rata-pnl' },
  async ({ page }) => {
    await signIn(page, 'owner')
    const name = unique()
    added.push(name)
    await addAndPayPart(page, name)

    try {
      // On: Overview asks its month as before, and the fixed costs beside it.
      const month = page.waitForResponse(
        (r) => r.url().endsWith('/rpc/overview_month') && r.status() === 200,
      )
      const listed = page.waitForResponse(
        (r) =>
          r.url().endsWith('/rpc/fixed_costs_list') &&
          r.request().postDataJSON()?.p_outlet_id === KAL &&
          r.status() === 200,
      )
      await page.goto('owner')
      await month
      const costs = ((await (await listed).json()) as Listed).costs
      expect(costs.some((cost) => cost.name === name)).toBe(true)
      await expect(page.getByTestId(`outlet-card-${KAL}`)).toContainText('P&L (Pro-rata)')

      await page.goto(`owner/ledger/expenses?outlet=${KAL}`)
      const chip = page.locator('[data-testid^="expense-fixed-"]').filter({ hasText: 'Fixed' })
      await expect(chip.first()).toBeVisible()

      // Off: the month alone, and the payment an ordinary expense.
      await forceGate(false)
      await page.goto('owner')
      const asked: string[] = []
      page.on('request', (r) => {
        if (r.url().includes('/rpc/')) asked.push(r.url().split('/rpc/')[1]!)
      })
      const alone = page.waitForResponse(
        (r) => r.url().endsWith('/rpc/overview_month') && r.status() === 200,
      )
      await rebootWith(page, false)
      await alone
      await expect(page.getByTestId(`outlet-card-${KAL}`)).toBeVisible()
      await expect(page.getByTestId(`outlet-card-${KAL}`)).not.toContainText('Pro-rata')
      expect(asked).not.toContain('fixed_costs_list')
      await page.goto(`owner/ledger/expenses?outlet=${KAL}`)
      await expect(page.getByText(name).first()).toBeVisible()
      await expect(page.locator('[data-testid^="expense-fixed-"]')).toHaveCount(0)

      // On again: the chip returns, and P&L (Pro-rata) charges only what is unpaid.
      await forceGate(true)
      await rebootWith(page, true)
      await expect(chip.first()).toBeVisible()
      await page.goto('owner')
      await expect(page.getByTestId(`outlet-card-${KAL}`)).toContainText('P&L (Pro-rata)')
    } finally {
      await forceGate(true)
    }
  },
)

test('a manager is refused the other outlet’s fixed costs', async ({ request }) => {
  const signedIn = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: LOCAL_ANON_KEY },
    data: { email: 'admin.kalyani@login.shawarmania.invalid', password: PASSWORD },
  })
  expect(signedIn.ok()).toBe(true)
  const { access_token: token } = (await signedIn.json()) as { access_token: string }
  const headers = { apikey: LOCAL_ANON_KEY, authorization: `Bearer ${token}` }
  const own = await request.post(`${SUPABASE_URL}/rest/v1/rpc/fixed_costs_list`, {
    headers,
    data: { p_outlet_id: KAL },
  })
  expect(own.status()).toBe(200)
  const crafted = await request.post(`${SUPABASE_URL}/rest/v1/rpc/fixed_costs_list`, {
    headers,
    data: { p_outlet_id: KPA },
  })
  expect(crafted.status()).toBe(403)
})

test('a Biller reads a cash payment as a cash expense, with no chip', async ({ browser }) => {
  const owner = await browser.newContext()
  const ownerPage = await owner.newPage()
  await signIn(ownerPage, 'owner')
  const name = unique()
  added.push(name)
  await addAndPayPart(ownerPage, name, true)
  await owner.close()

  const biller = await browser.newContext()
  const page = await biller.newPage()
  await signIn(page, 'biller.kalyani')
  await page.goto('staff/ledger/expenses')
  await expect(page.getByText(name).first()).toBeVisible()
  await expect(page.locator('[data-testid^="expense-fixed-"]')).toHaveCount(0)
  await biller.close()
})
