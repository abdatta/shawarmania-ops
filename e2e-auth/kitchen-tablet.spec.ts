import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

import {
  LOCAL_ANON_KEY,
  PASSWORD,
  SPARE_SHIFT,
  SPARE_TILL,
  SUPABASE_URL,
  TILL_ONE,
  TILL_TWO,
  openTill,
  orderCard,
  railSettled,
  saveNewOrder,
  serviceRoleKey,
  setSpareTillInService,
} from './tills'

/**
 * #70 the-kitchen-sees-its-orders, end to end on the local stack: a counter
 * tablet and a kitchen tablet, each in its own browser context, meeting only at
 * the server. The seed's spare till is turned into a kitchen for the run and
 * put back afterwards — as a billing till, whatever happened in between.
 */

let nextCustomerDigits = 9000007000

async function identifyCustomer(page: Page, name: string) {
  await page.getByTestId('customer-row').click()
  const dialog = page.getByRole('dialog', { name: 'Customer' })
  for (const digit of String((nextCustomerDigits += 1))) {
    await dialog.getByRole('button', { name: digit, exact: true }).click()
  }
  await dialog.getByPlaceholder(/name/i).fill(name)
  await dialog.getByTestId('customer-confirm').click()
  await expect(dialog).toHaveCount(0)
}

async function saveOrder(page: Page, customerName: string): Promise<string> {
  await page.getByRole('button', { name: 'Classic Chicken Shawarma', exact: true }).click()
  await identifyCustomer(page, customerName)
  return saveNewOrder(page, async () => {
    await page.getByRole('button', { name: 'Order', exact: true }).click()
    await expect(page.getByTestId('bill-total')).toHaveCount(0)
  })
}

async function setSpareKind(request: APIRequestContext, kind: 'counter' | 'kitchen') {
  const key = serviceRoleKey()
  const headers = {
    apikey: key,
    authorization: `Bearer ${key}`,
    'content-type': 'application/json',
    prefer: 'return=minimal',
  }
  const device = await request.patch(`${SUPABASE_URL}/rest/v1/counter_devices`, {
    headers,
    params: { id: `eq.${SPARE_TILL}` },
    data: { kind, kitchen_filter_mode: 'exclude', kitchen_category_ids: [] },
  })
  expect(device.ok(), 'could not set the spare till kind').toBe(true)
  const shift = await request.patch(`${SUPABASE_URL}/rest/v1/counter_shifts`, {
    headers,
    params: { id: `eq.${SPARE_SHIFT}` },
    data: { kind },
  })
  expect(shift.ok(), 'could not set the spare till shift kind').toBe(true)
}

/** The spare till, signed in as the machine it is, opened at `/counter`. */
async function openKitchen(browser: Parameters<typeof openTill>[0], request: APIRequestContext) {
  const response = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: LOCAL_ANON_KEY },
    data: { email: `${TILL_TWO.alias}@login.shawarmania.invalid`, password: PASSWORD },
  })
  expect(response.ok(), 'the spare till could not sign in').toBe(true)
  const session = (await response.json()) as Record<string, unknown>
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.addInitScript((value) => {
    localStorage.setItem('shawarmania.auth', JSON.stringify(value))
  }, session)
  // Opened at the counter's address: a kitchen goes where its kind says.
  await page.goto('counter')
  await expect(page).toHaveURL(/\/kitchen$/)
  await expect(page.getByRole('heading', { name: TILL_TWO.label })).toBeVisible()
  await expect(page.getByTestId('kitchen-filter-summary')).toHaveText('Everything')
  return { context, page }
}

test('a counter rings a kitchen, ACK quiets it, Prepared clears it, and losing sync says so', async ({
  browser,
  request,
}) => {
  test.slow()

  await setSpareTillInService(request, true)
  await setSpareKind(request, 'kitchen')
  const kitchen = await openKitchen(browser, request)
  const counter = await openTill(browser, request, TILL_ONE)

  try {
    // An order taken at the counter arrives in the kitchen, new and alerting,
    // with no customer anywhere on the kitchen's screen.
    const id = await saveOrder(counter.page, 'Kitchen Sees This')
    const card = kitchen.page.locator(`[data-order-id="${id}"]`)
    await expect(card).toBeVisible({ timeout: 30_000 })
    await expect(card).toHaveAttribute('data-state', 'new')
    await expect(card).toContainText('Classic Chicken Shawarma')
    await expect(kitchen.page.getByText('Kitchen Sees This')).toHaveCount(0)

    // ACK quiets it, and the acknowledgement is the server's.
    await card.getByRole('button', { name: /^ACK order / }).click()
    await expect(card).toHaveAttribute('data-state', 'quiet')
    await kitchen.page.reload()
    await expect(kitchen.page.locator(`[data-order-id="${id}"]`)).toHaveAttribute(
      'data-state',
      'quiet',
    )

    // Prepared at the counter takes it off the kitchen, with no ACK.
    await railSettled(counter.page)
    await orderCard(counter.page, id).getByRole('button', { name: 'Prepared' }).click()
    await expect(kitchen.page.locator(`[data-order-id="${id}"]`)).toHaveCount(0, {
      timeout: 30_000,
    })

    // Losing the network is said, and said loudly.
    await kitchen.context.setOffline(true)
    await expect(kitchen.page.getByTestId('kitchen-sync-alert')).toBeVisible()
    await kitchen.context.setOffline(false)
    await expect(kitchen.page.getByTestId('kitchen-sync-alert')).toHaveCount(0, {
      timeout: 30_000,
    })
  } finally {
    await kitchen.context.close()
    await counter.context.close()
    await setSpareKind(request, 'counter')
    await setSpareTillInService(request, false)
  }
})
