import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'

import { MAX_BILLING_RETRY_MS } from '../src/outbox/drain'
import {
  AFTER_LOCAL_ACCEPTANCE_MS,
  LOCAL_ANON_KEY,
  OUTLET_KALYANI,
  PASSWORD,
  SUPABASE_URL,
  TILL_ONE,
  TILL_TWO,
  openTill,
  setSpareTillInService,
} from './tills'

/**
 * How an outlet serves, on the real counter against the real backend
 * (each-outlet-chooses-how-it-serves, #60, tasks 5.5 and 5.6).
 *
 * Everything below this layer has proved its part: pgTAP the boundary, the
 * REST probes the grants, the unit tests each adapter's payload. What only a
 * real tablet can show is the whole chain at once — the settings reaching the
 * counter with its menu, the counter asking, the answer riding an IndexedDB
 * queue through an outage, and the server settling it exactly once. And two
 * tills seating one table while one cannot see the other, which is the case
 * the database records rather than refuses.
 *
 * Kalyani is switched on by its manager through the narrow function for the
 * length of this file and put back to all-off after it, as the seed has it.
 * The seed's customer Kalyani has served is made gold there for the member's
 * takeaway, and put back too. Since a-regular-earns-points-and-gold (#62) gold
 * is an outlet's: Kalyani switches gold on for this file, and a management
 * grant reaches only a customer that outlet has served.
 */

const GOLD_CUSTOMER = '80000000-0000-4000-a000-000000000001'
const GOLD_PHONE_DIGITS = '9000000001'
const GOLD_PHONE = '+919000000001'
/**
 * How long a reconnected till may take to drain what it queued: the outbox's
 * longest retry delay, then room to deliver the chain waiting behind it.
 *
 * Not less. A command that failed offline keeps its backoff in IndexedDB, and
 * only the `online` event pulls it forward. The reload that follows reconnect
 * can win that race, or abort a delivery in flight and leave it a fresh full
 * delay, and the new page then waits it out. A budget equal to the delay itself
 * passed on an idle machine with under two seconds to spare and failed on a
 * loaded one, as `stalled`, then `pending`, then out of time.
 */
const DRAIN_MS = MAX_BILLING_RETRY_MS + 30_000
/**
 * How long an offline till takes to draw a card it just saved: the pipeline
 * read has to fail through the network stack before the queue answers it, as
 * `billing-offline.spec.ts` measures for its own reads.
 */
const OFFLINE_READ_MS = 30_000

test.describe.configure({ mode: 'serial' })

async function accessToken(request: APIRequestContext, alias: string): Promise<string> {
  const response = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: LOCAL_ANON_KEY },
    data: { email: `${alias}@login.shawarmania.invalid`, password: PASSWORD },
  })
  expect(response.ok(), `${alias} could not sign in`).toBe(true)
  return ((await response.json()) as { access_token: string }).access_token
}

async function rpc(
  request: APIRequestContext,
  token: string,
  fn: string,
  args: Record<string, unknown>,
) {
  const response = await request.post(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    headers: { apikey: LOCAL_ANON_KEY, authorization: `Bearer ${token}` },
    data: args,
  })
  expect(response.ok(), `${fn} failed: ${await response.text()}`).toBe(true)
}

/** Kalyani's choices, set the way its manager sets them. */
async function setKalyaniServing(request: APIRequestContext, everything: boolean) {
  await rpc(request, await accessToken(request, 'admin.kalyani'), 'set_outlet_service_settings', {
    p_outlet: OUTLET_KALYANI,
    p_dine_in_offered: everything,
    p_takeaway_offered: everything,
    p_table_numbers: everything,
    p_packaging_mode: everything ? 'per_bag' : 'off',
    p_packaging_price_paise: everything ? 500 : null,
    p_packaging_free_for_gold: everything,
  })
}

interface ServedOrder {
  id: string
  status: string
  service_type: string | null
  table_number: number | null
  table_shared: boolean
  discount_paise: number
  customer_name: string | null
  order_items: {
    kind: string
    quantity: number
    unit_price_paise: number
    discount_paise: number
    discount_percent_bp: number | null
  }[]
}

async function ordersWhere(
  request: APIRequestContext,
  token: string,
  filter: Record<string, string>,
): Promise<ServedOrder[]> {
  const response = await request.get(`${SUPABASE_URL}/rest/v1/orders`, {
    headers: { apikey: LOCAL_ANON_KEY, authorization: `Bearer ${token}` },
    params: {
      select:
        'id,status,service_type,table_number,table_shared,discount_paise,customer_name,order_items(kind,quantity,unit_price_paise,discount_paise,discount_percent_bp)',
      ...filter,
    },
  })
  expect(response.ok()).toBe(true)
  return (await response.json()) as ServedOrder[]
}

async function billFor(request: APIRequestContext, token: string, orderId: string) {
  const response = await request.get(`${SUPABASE_URL}/rest/v1/bills`, {
    headers: { apikey: LOCAL_ANON_KEY, authorization: `Bearer ${token}` },
    params: {
      select: 'service_type,table_number,discount_paise,bill_items(kind,quantity,discount_paise)',
      order_id: `eq.${orderId}`,
    },
  })
  expect(response.ok()).toBe(true)
  return (await response.json()) as {
    service_type: string | null
    table_number: number | null
    discount_paise: number
    bill_items: { kind: string; quantity: number; discount_paise: number }[]
  }[]
}

/**
 * Unique per run, not per file. An online till that is handed a number an
 * earlier run saved finds that customer and rings the order under the old name,
 * so a fixed range makes a rerun without a reset look up somebody else.
 */
let nextCustomerDigits = Number(`9${String(Date.now()).slice(-9)}`)

/** A new customer by keypad; offline this is the no-match path, which is fine. */
async function identifyNew(page: Page, name: string) {
  await page.getByTestId('customer-row').click()
  const dialog = page.getByRole('dialog', { name: 'Customer' })
  for (const digit of String((nextCustomerDigits += 1))) {
    await dialog.getByRole('button', { name: digit, exact: true }).click()
  }
  await dialog.getByPlaceholder(/name/i).fill(name)
  await dialog.getByTestId('customer-confirm').click()
  await expect(dialog).toHaveCount(0)
}

async function keyTable(page: Page, digits: string) {
  const pad = page.getByRole('dialog', { name: 'Which table' })
  await expect(pad).toBeVisible()
  for (const digit of digits) {
    await pad.getByRole('button', { name: digit, exact: true }).click()
  }
  await pad.getByTestId('table-confirm').click()
  await expect(pad).toHaveCount(0)
}

async function addShawarma(page: Page) {
  await page.getByRole('button', { name: 'Classic Chicken Shawarma', exact: true }).click()
}

async function saveOrder(page: Page) {
  await page.getByTestId('save-order').click()
  await expect(page.getByTestId('bill-total')).toHaveCount(0)
}

function cardsAt(page: Page, text: string) {
  return page
    .getByTestId('counter-activity-rail')
    .locator('[data-testid^="open-order-"]')
    .filter({ hasText: text })
}

/**
 * Cards this till rang and has not yet sent, which carry no order number.
 *
 * For an order no run-unique text can find. The gold member is the seed's one
 * customer, so "Takeaway" also matches a member takeaway an earlier, failed run
 * left on the server, and a rerun without a reset found two of them. Anything
 * the server already holds has a number, so this run's offline work is exactly
 * the unnumbered cards.
 */
function unsentCardsAt(page: Page, text: string) {
  return page
    .getByTestId('counter-activity-rail')
    .locator('[data-testid^="open-order-local-"]')
    .filter({ hasText: text })
}

/** Pay an open order from its card, as a biller does. */
async function payCard(page: Page, cards: Locator) {
  const paid = cards.getByRole('button', {
    name: 'Paid',
    exact: true,
    pressed: false,
  })
  await expect(paid).toBeVisible({ timeout: OFFLINE_READ_MS })
  await paid.click()
  const payment = page.getByRole('dialog', { name: 'Record payment' })
  await payment.getByRole('button', { name: 'Cash', exact: true }).click()
  await payment.getByRole('button', { name: 'Paid', exact: true }).click()
  await expect(page.locator('dialog[open]')).toHaveCount(0)
}

/**
 * Mark a paid order prepared, which takes it off the rail into the shift's
 * bills, so a rerun's rail holds only its own work.
 */
async function serveCard(card: Locator) {
  await card.getByRole('button', { name: 'Prepared', exact: true, pressed: false }).click()
  await expect(card).toHaveCount(0, { timeout: OFFLINE_READ_MS })
}

/**
 * Take an order this file left open off the rail, so a rerun without a reset
 * does not find its tables still busy.
 */
async function cancelCard(page: Page, reference: string, text: string) {
  const card = cardsAt(page, text)
  await card.getByRole('button', { name: `More actions for ${reference}` }).click()
  await card.getByRole('menuitem', { name: 'Cancel order' }).click()
  const dialog = page.getByRole('dialog', { name: /^Cancel/ })
  await dialog.getByRole('textbox', { name: 'Cancellation reason' }).fill('End-to-end test')
  await dialog.getByRole('button', { name: 'Confirm cancel' }).click()
  await expect(card).toHaveCount(0)
  // Accepted locally is not delivered. A till closed before its queue drains
  // takes the cancellation with it, and the order stays open for the next run.
  await expect(page.getByTestId('sync-indicator').first()).toHaveAttribute('data-sync', 'synced', {
    timeout: DRAIN_MS,
  })
}

/** Gold at Kalyani, on or off, and nothing else about points (#62). */
async function setKalyaniGold(request: APIRequestContext, on: boolean) {
  await rpc(request, await accessToken(request, 'admin.kalyani'), 'set_outlet_loyalty_settings', {
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
  })
}

test.beforeAll(async ({ request }) => {
  await setKalyaniServing(request, true)
  await setKalyaniGold(request, true)
  await rpc(request, await accessToken(request, 'owner'), 'customer_membership_grant', {
    p_outlet: OUTLET_KALYANI,
    p_customer: GOLD_CUSTOMER,
  })
})

test.afterAll(async ({ request }) => {
  await setKalyaniServing(request, false)
  // Revoked while gold is still on: with it off, the outlet has no gold to end.
  await rpc(request, await accessToken(request, 'owner'), 'customer_membership_revoke', {
    p_outlet: OUTLET_KALYANI,
    p_customer: GOLD_CUSTOMER,
  })
  await setKalyaniGold(request, false)
})

test('orders rung offline with a table, bags and a waiver each settle exactly once, carrying them', async ({
  browser,
  request,
}) => {
  test.setTimeout(240_000)
  const run = Date.now().toString(36)
  const tableCustomer = `E2E table ${run}`
  const bagsCustomer = `E2E bags ${run}`
  const token = await accessToken(request, 'admin.kalyani')
  const { context, page } = await openTill(browser, request, TILL_ONE)

  try {
    // The choices reached the counter with its menu: both types are asked.
    const startedAt = new Date(Date.now() - 1_000).toISOString()
    await addShawarma(page)
    await expect(page.getByTestId('service-chip-dine_in')).toBeVisible()
    await expect(page.getByTestId('service-chip-takeaway')).toBeVisible()

    // The member is looked up while the tablet can still reach the directory,
    // so it knows them as gold when the network goes.
    await page.getByTestId('customer-row').click()
    const customer = page.getByRole('dialog', { name: 'Customer' })
    for (const digit of GOLD_PHONE_DIGITS) {
      await customer.getByRole('button', { name: digit, exact: true }).click()
    }
    await expect(customer.getByTestId('customer-match')).toBeVisible()
    await customer.getByTestId('customer-confirm').click()
    await expect(customer).toHaveCount(0)
    // The customer is answered; where the food goes is still owed.
    await expect(page.getByTestId('save-order')).toBeDisabled()

    await context.setOffline(true)

    // 1. The member's takeaway: two bags, both waived. Paid at once, while it
    //    is the only takeaway on the rail waiting for its money.
    await page.getByTestId('service-chip-takeaway').click()
    await page.getByRole('button', { name: 'One more Packaging' }).click()
    await expect(page.getByTestId('bill-quantity-packaging')).toHaveText('2')
    await expect(page.getByTestId('bill-line-packaging')).toHaveAttribute('data-waived', 'true')
    await saveOrder(page)
    await payCard(page, unsentCardsAt(page, 'Takeaway'))
    await serveCard(unsentCardsAt(page, 'Takeaway'))

    // 2. Dine-in at table 3.
    await addShawarma(page)
    await identifyNew(page, tableCustomer)
    await page.getByTestId('service-chip-dine_in').click()
    await keyTable(page, '3')
    await expect(page.getByTestId('service-chip-dine_in')).toHaveText('Table 3')
    await saveOrder(page)

    // 3. A takeaway with two bags, charged.
    await addShawarma(page)
    await identifyNew(page, bagsCustomer)
    await page.getByTestId('service-chip-takeaway').click()
    await page.getByRole('button', { name: 'One more Packaging' }).click()
    await saveOrder(page)

    // Revise one: a second shawarma at table 3, still offline. Found by this
    // run's customer, not by the table, which an earlier run may still hold.
    const table = cardsAt(page, tableCustomer)
    await expect(table).toHaveCount(1, { timeout: OFFLINE_READ_MS })
    await table.getByRole('button', { name: /^More actions for Table 3$/ }).click()
    await table.getByRole('menuitem', { name: 'Edit' }).click()
    await addShawarma(page)
    await page.getByTestId('editing-order-pin').getByTestId('save-order').click()
    await expect(page.getByTestId('editing-order-pin')).toHaveCount(0)

    // The second payment, still offline.
    await payCard(page, cardsAt(page, bagsCustomer))
    await serveCard(cardsAt(page, bagsCustomer))
    await page.waitForTimeout(AFTER_LOCAL_ACCEPTANCE_MS)

    // Nothing has reached the server yet.
    expect(await ordersWhere(request, token, { customer_name: `eq.${tableCustomer}` })).toEqual([])

    // Back online: everything drains, once.
    await context.setOffline(false)
    await page.reload()
    await expect(page.getByTestId('menu-grid')).toBeVisible()
    await expect(page.getByTestId('sync-indicator').first()).toHaveAttribute(
      'data-sync',
      'synced',
      {
        timeout: DRAIN_MS,
      },
    )

    const atTable = await ordersWhere(request, token, { customer_name: `eq.${tableCustomer}` })
    expect(atTable).toHaveLength(1)
    expect(atTable[0]).toMatchObject({
      status: 'open',
      service_type: 'dine_in',
      table_number: 3,
    })
    expect(atTable[0]!.order_items).toEqual([
      expect.objectContaining({ kind: 'item', quantity: 2 }),
    ])

    const bags = await ordersWhere(request, token, { customer_name: `eq.${bagsCustomer}` })
    expect(bags).toHaveLength(1)
    expect(bags[0]).toMatchObject({ status: 'paid', service_type: 'takeaway', table_number: null })
    expect(bags[0]!.order_items).toContainEqual(
      expect.objectContaining({
        kind: 'packaging',
        quantity: 2,
        unit_price_paise: 500,
        discount_paise: 0,
      }),
    )

    const member = await ordersWhere(request, token, {
      customer_phone: `eq.${GOLD_PHONE}`,
      service_type: 'eq.takeaway',
      ordered_at: `gte.${startedAt}`,
    })
    expect(member).toHaveLength(1)
    expect(member[0]).toMatchObject({ status: 'paid', discount_paise: 1000 })
    expect(member[0]!.order_items).toContainEqual(
      expect.objectContaining({
        kind: 'packaging',
        quantity: 2,
        discount_paise: 1000,
        discount_percent_bp: 10_000,
      }),
    )

    // The bills copied the facts, the waiver included.
    const [memberBill] = await billFor(request, token, member[0]!.id)
    expect(memberBill).toMatchObject({ service_type: 'takeaway', discount_paise: 1000 })
    expect(memberBill!.bill_items).toContainEqual(
      expect.objectContaining({ kind: 'packaging', quantity: 2, discount_paise: 1000 }),
    )
    const [bagsBill] = await billFor(request, token, bags[0]!.id)
    expect(bagsBill).toMatchObject({ service_type: 'takeaway', table_number: null })

    await cancelCard(page, 'Table 3', tableCustomer)
  } finally {
    await context.close()
  }
})

test('two tills seat one table while one is offline, and both orders say so', async ({
  browser,
  request,
}) => {
  test.setTimeout(240_000)
  const run = Date.now().toString(36)
  const seatedOne = `E2E seat one ${run}`
  const seatedTwo = `E2E seat two ${run}`
  const token = await accessToken(request, 'admin.kalyani')

  await setSpareTillInService(request, true)
  const one = await openTill(browser, request, TILL_ONE)
  const two = await openTill(browser, request, TILL_TWO)

  try {
    // Till two seats table 4 where till one cannot see it.
    await two.context.setOffline(true)
    await addShawarma(two.page)
    await identifyNew(two.page, seatedTwo)
    await two.page.getByTestId('service-chip-dine_in').click()
    await keyTable(two.page, '4')
    await saveOrder(two.page)

    // Till one, online, sees nothing at table 4 and seats it too. The counter
    // refuses only a table it can see is busy (design D5).
    await addShawarma(one.page)
    await identifyNew(one.page, seatedOne)
    await one.page.getByTestId('service-chip-dine_in').click()
    await keyTable(one.page, '4')
    await saveOrder(one.page)

    // Till two reconnects and drains; the database records both, refusing
    // neither, and marks each as having shared its table.
    await two.context.setOffline(false)
    await expect
      .poll(
        async () =>
          (
            await ordersWhere(request, token, {
              customer_name: `in.(${seatedOne},${seatedTwo})`,
            })
          ).length,
        { timeout: DRAIN_MS },
      )
      .toBe(2)
    const both = await ordersWhere(request, token, {
      customer_name: `in.(${seatedOne},${seatedTwo})`,
    })
    for (const order of both) {
      expect(order).toMatchObject({
        status: 'open',
        service_type: 'dine_in',
        table_number: 4,
        table_shared: true,
      })
    }

    // And both tills call them Table 4, each saying which of the two it is.
    for (const page of [one.page, two.page]) {
      await page.reload()
      await expect(page.getByTestId('menu-grid')).toBeVisible()
      const atFour = cardsAt(page, 'Table 4')
      await expect(atFour).toHaveCount(2, { timeout: 20_000 })
      await expect(cardsAt(page, seatedTwo)).toContainText('1 of 2')
      await expect(cardsAt(page, seatedOne)).toContainText('2 of 2')
    }

    // Each till takes its own off the rail; neither may cancel the other's.
    await cancelCard(one.page, 'Table 4', seatedOne)
    await cancelCard(two.page, 'Table 4', seatedTwo)
  } finally {
    await one.context.close()
    await two.context.close()
    await setSpareTillInService(request, false)
  }
})

test('the owner reads and changes how an outlet serves on its live page', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('sign-in')
  await page.getByLabel('Username or email', { exact: true }).fill('owner')
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible()

  await page.goto(`owner/outlets/${OUTLET_KALYANI}`)
  const orders = page.getByTestId('service-orders')
  // What the manager saved for this file, read back off the live row.
  const tables = orders.getByRole('switch', { name: 'Table numbers' })
  await expect(tables).toHaveAttribute('aria-checked', 'true')

  await tables.click()
  await orders.getByTestId('service-save').click()
  await expect(orders.getByTestId('service-saved')).toBeVisible()

  const response = await request.get(`${SUPABASE_URL}/rest/v1/outlets`, {
    headers: {
      apikey: LOCAL_ANON_KEY,
      authorization: `Bearer ${await accessToken(request, 'admin.kalyani')}`,
    },
    params: { select: 'dine_in_offered,table_numbers', id: `eq.${OUTLET_KALYANI}` },
  })
  expect(response.ok()).toBe(true)
  expect(await response.json()).toEqual([{ dine_in_offered: true, table_numbers: false }])
})
