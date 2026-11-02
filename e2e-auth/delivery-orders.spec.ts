import type { APIRequestContext } from '@playwright/test'

import { expect, test } from './test'
import {
  LOCAL_ANON_KEY,
  OUTLET_KALYANI,
  PASSWORD,
  SUPABASE_URL,
  TILL_ONE,
  openTill,
  orderCard,
  saveNewOrder,
  serviceRoleKey,
} from './tills'

/**
 * Delivery orders over the real transport (delivery-orders-are-made-not-billed,
 * design D9): a delivery order and its handover, queued offline with the gate
 * on, still land after the gate is turned off, because the outbox never reads a
 * gate and the server takes both whatever it says. The order is handed over,
 * gone from the rail, and never billed.
 *
 * The stack is shared with the specs after this one, so Kalyani's Delivery
 * choice and the gate are put back however the test ends.
 */

function serviceHeaders() {
  const key = serviceRoleKey()
  return { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' }
}

async function forceGate(enabled: boolean) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/change_gate_force`, {
    method: 'POST',
    headers: serviceHeaders(),
    body: JSON.stringify({
      p_key: 'delivery-orders',
      p_enabled: enabled,
      p_reason: 'auth browser tests, the delivery-orders round trip',
    }),
  })
  if (!response.ok) throw new Error(`change_gate_force failed: ${response.status}`)
}

async function offerDelivery(request: APIRequestContext, offered: boolean) {
  const response = await request.patch(`${SUPABASE_URL}/rest/v1/outlets`, {
    headers: serviceHeaders(),
    params: { id: `eq.${OUTLET_KALYANI}` },
    data: { delivery_offered: offered },
  })
  expect(response.ok(), 'could not set Kalyani’s Delivery choice').toBe(true)
}

async function rows<T>(request: APIRequestContext, table: string, params: Record<string, string>) {
  const response = await request.get(`${SUPABASE_URL}/rest/v1/${table}`, {
    headers: serviceHeaders(),
    params,
  })
  expect(response.ok(), `could not read ${table}`).toBe(true)
  return (await response.json()) as T[]
}

/**
 * A delivery row as the outlet's Franchise Admin reads it: the service role has
 * no grant on the table (only counters, their admins and the owner read it).
 */
async function deliveryRows(request: APIRequestContext, orderId: string) {
  const signIn = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: LOCAL_ANON_KEY },
    data: { email: 'admin.kalyani@login.shawarmania.invalid', password: PASSWORD },
  })
  expect(signIn.ok(), 'the Kalyani admin could not sign in').toBe(true)
  const { access_token } = (await signIn.json()) as { access_token: string }
  const response = await request.get(`${SUPABASE_URL}/rest/v1/delivery_orders`, {
    headers: { apikey: LOCAL_ANON_KEY, authorization: `Bearer ${access_token}` },
    params: { order_id: `eq.${orderId}`, select: 'handed_over_at' },
  })
  expect(response.ok(), 'could not read delivery_orders').toBe(true)
  return (await response.json()) as { handed_over_at: string | null }[]
}

test(
  'a delivery order and its handover queued while on land after the gate is off',
  { tag: '@cg-round-trip:delivery-orders' },
  async ({ browser, request }) => {
    test.setTimeout(120_000)
    await offerDelivery(request, true)
    const { context, page } = await openTill(browser, request, TILL_ONE)
    try {
      await context.setOffline(true)
      await page.getByRole('button', { name: 'Classic Chicken Shawarma', exact: true }).click()
      await page.getByTestId('service-chip-delivery').click()
      await page.locator('#order-label').fill('ZMT round trip')
      const id = await saveNewOrder(page, () => page.getByTestId('save-order').click(), {
        timeout: 20_000,
      })
      const card = orderCard(page, id)
      await card.getByRole('button', { name: /^Tick / }).click()
      await card.getByTestId(`hand-over-${id}`).click()
      await expect(card).toHaveCount(0, { timeout: 15_000 })

      // Off at the server while the tablet still holds both, then back online.
      await forceGate(false)
      await context.setOffline(false)

      await expect
        .poll(
          async () =>
            (
              await rows<{ status: string }>(request, 'orders', {
                id: `eq.${id}`,
                select: 'status',
              })
            )[0]?.status,
          { timeout: 60_000 },
        )
        .toBe('handed_over')
      const delivery = await deliveryRows(request, id)
      expect(delivery).toHaveLength(1)
      expect(delivery[0]!.handed_over_at).not.toBeNull()
      expect(await rows(request, 'bills', { order_id: `eq.${id}`, select: 'id' })).toHaveLength(0)
    } finally {
      await forceGate(true)
      await offerDelivery(request, false)
      await context.close()
    }
  },
)
