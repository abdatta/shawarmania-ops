import { type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { expect, test } from './test'

import { everyGate } from '../e2e/support/change-gates'
import { SAVED_ANSWERS_KEY } from '../src/change-gates/snapshot'

import {
  LOCAL_ANON_KEY,
  PASSWORD,
  SUPABASE_URL,
  TILL_ONE,
  TILL_TWO,
  openKitchen,
  openTill,
  orderCard,
  railSettled,
  saveNewOrder,
  serviceRoleKey,
  setSpareKind,
  setSpareTillInService,
} from './tills'
import { turnEveryGate } from './change-gates.setup'

/**
 * #74 each-dish-is-ticked-off, relaunched behind its gates
 * (a-release-can-be-switched-off), end to end on the local stack: a counter
 * tablet and a kitchen tablet in their own contexts, meeting only at the server.
 * The seed's spare till is turned into a kitchen for each test and put back
 * afterwards as a billing till.
 *
 * `@cg-on:dish-ticks` and `@cg-on:kitchen-ready` hold only with that gate on;
 * `@cg-round-trip:<key>` runs with gates on, turns its own gate off through the
 * service role in the middle of an order's life, and finishes the order on the
 * old path (design R4). Nothing here asserts the Ready sound: it is
 * synthesised, and its timing belongs to the unit tests.
 */

const LABEL = 'Red shirt'
const NOTE = 'No sauce'
const CLASSIC = 'Classic Chicken Shawarma'
const MAYO = 'Mayonnaise Chicken Shawarma'

const DISH_TICKS = 'dish-ticks'
const KITCHEN_READY = 'kitchen-ready'

function serviceHeaders() {
  const key = serviceRoleKey()
  return { apikey: key, authorization: `Bearer ${key}` }
}

/** A table's rows through the service role, for what only the database can say. */
async function rows<T>(
  request: APIRequestContext,
  table: string,
  params: Record<string, string>,
): Promise<T[]> {
  const response = await request.get(`${SUPABASE_URL}/rest/v1/${table}`, {
    headers: serviceHeaders(),
    params,
  })
  expect(response.ok(), `could not read ${table}`).toBe(true)
  return (await response.json()) as T[]
}

/**
 * The labels of an order, as the outlet's Franchise Admin reads them. The
 * service role has no grant on `order_labels` (no client role writes it, and
 * only counters, their admins and the owner read it), so the one reader the
 * policy names stands in.
 */
async function labelsOf(request: APIRequestContext, orderId: string): Promise<string[]> {
  const signIn = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: LOCAL_ANON_KEY },
    data: { email: 'admin.kalyani@login.shawarmania.invalid', password: PASSWORD },
  })
  expect(signIn.ok(), 'the Kalyani admin could not sign in').toBe(true)
  const { access_token } = (await signIn.json()) as { access_token: string }
  const response = await request.get(`${SUPABASE_URL}/rest/v1/order_labels`, {
    headers: { apikey: LOCAL_ANON_KEY, authorization: `Bearer ${access_token}` },
    params: { order_id: `eq.${orderId}`, select: 'label' },
  })
  expect(response.ok(), 'could not read order_labels').toBe(true)
  return ((await response.json()) as { label: string }[]).map((row) => row.label)
}

/** One bill for the order, and still one a moment later: it settled exactly once. */
async function expectOneBill(request: APIRequestContext, orderId: string) {
  const bills = () => rows(request, 'bills', { order_id: `eq.${orderId}`, select: 'id' })
  await expect.poll(async () => (await bills()).length, { timeout: 60_000 }).toBe(1)
  await new Promise((resolve) => setTimeout(resolve, 3_000))
  expect(await bills()).toHaveLength(1)
}

/** The service role's turn of one gate, recorded in its history like any other. */
async function turnGate(request: APIRequestContext, key: string, enabled: boolean) {
  const response = await request.post(`${SUPABASE_URL}/rest/v1/rpc/change_gate_force`, {
    headers: { ...serviceHeaders(), 'content-type': 'application/json' },
    data: { p_key: key, p_enabled: enabled, p_reason: 'auth round-trip test' },
  })
  expect(response.ok(), `could not turn ${key} ${enabled ? 'on' : 'off'}`).toBe(true)
}

/**
 * Every gate back on, parents first: what the gates-on run needs after a round
 * trip. Every gate, not only the one the test turned: turning a gate off turns
 * off every gate that depends on it (`instant-saves` on both of these), and
 * turning it back on leaves them off. A dependent left off made each later
 * spec's tablet boot with it on, read it off, and reload into the old screens
 * at its first free moment, mid-test.
 */
async function turnEveryGateOn() {
  await turnEveryGate('on')
}

/**
 * What a tablet that has heard the turn holds: every gate on but these. Saved in
 * the page's own storage before it reloads, the way the update path leaves it,
 * so the reload boots into the answer the database now gives.
 */
async function hearTurn(page: Page, off: string[]) {
  const answers = { ...everyGate(true), ...Object.fromEntries(off.map((key) => [key, false])) }
  await page.evaluate(
    ([key, value]) => localStorage.setItem(key!, value!),
    [SAVED_ANSWERS_KEY, JSON.stringify(answers)],
  )
  await page.reload()
}

/** The composer's way to an order: label, a noted dish, optionally a second dish. */
async function ringDishOrder(
  page: Page,
  { label, note, second }: { label?: string; note?: string; second?: boolean },
): Promise<string> {
  await page.getByRole('button', { name: CLASSIC, exact: true }).click()
  if (label !== undefined) await page.getByPlaceholder('Order Label').fill(label)
  if (note !== undefined) {
    await page.getByRole('button', { name: `Note for ${CLASSIC}`, exact: true }).click()
    const sheet = page.getByRole('dialog', { name: `Note for ${CLASSIC}` })
    await sheet.getByRole('textbox', { name: 'Dish note' }).fill(note)
    await sheet.getByRole('button', { name: 'Save note', exact: true }).click()
    await expect(sheet).toHaveCount(0)
  }
  if (second) await page.getByRole('button', { name: MAYO, exact: true }).click()
  await page.getByRole('button', { name: 'Enter Customer Info', exact: true }).click()
  await page
    .getByRole('dialog', { name: 'Customer' })
    .getByRole('button', { name: 'Skip', exact: true })
    .click()
  return saveNewOrder(
    page,
    async () => {
      await page.getByRole('button', { name: 'Order', exact: true }).click()
    },
    { timeout: 15_000 },
  )
}

/** Take cash for a card's order. A receipt prompt may come first, and is skipped. */
async function payCard(page: Page, card: Locator) {
  await railSettled(page)
  await card.getByRole('button', { name: 'Paid', exact: true }).click()
  const receipt = page.getByRole('dialog', { name: 'Receipt and points' })
  const payment = page.getByRole('dialog', { name: 'Record payment' })
  await expect(receipt.or(payment)).toBeVisible()
  if (await receipt.isVisible())
    await receipt.getByRole('button', { name: 'Skip', exact: true }).click()
  await payment.getByRole('button', { name: 'Cash', exact: true }).click()
  await payment.getByRole('button', { name: 'Paid', exact: true }).click()
  await expect(payment).toHaveCount(0)
}

/** The accessible name of each dish's Tick button on a card, in order. */
async function tickNames(card: Locator): Promise<string[]> {
  const ticks = card.getByRole('button', { name: /^Tick / })
  await expect(ticks.first()).toBeVisible({ timeout: 30_000 })
  return ticks.evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label')!))
}

async function closeAll(
  tablets: { context: { close(): Promise<void> } }[],
  request: APIRequestContext,
) {
  for (const tablet of tablets) await tablet.context.close()
  await setSpareKind(request, 'counter')
  await setSpareTillInService(request, false)
}

test(
  'a labelled order with a noted dish reaches the kitchen with its note and never its label, and a dish ticks and unticks',
  { tag: '@cg-on:dish-ticks' },
  async ({ browser, request }) => {
    test.slow()
    await setSpareTillInService(request, true)
    await setSpareKind(request, 'kitchen')
    const kitchen = await openKitchen(browser, request)
    const counter = await openTill(browser, request, TILL_ONE)
    try {
      const id = await ringDishOrder(counter.page, { label: LABEL, note: NOTE, second: true })
      const card = orderCard(counter.page, id)

      // The label is the counter's own: on the card, in the database, never at the kitchen.
      await expect(card).toContainText(LABEL)
      const ticket = kitchen.page.locator(`[data-order-id="${id}"]`)
      await expect(ticket).toBeVisible({ timeout: 30_000 })
      await expect(ticket).toContainText(NOTE)
      await expect(ticket).toContainText(MAYO)
      await expect(kitchen.page.getByText(LABEL)).toHaveCount(0)
      expect(await labelsOf(request, id)).toEqual([LABEL])
      expect(
        (
          await rows<{ note: string | null }>(request, 'order_items', {
            order_id: `eq.${id}`,
            select: 'note',
            note: 'not.is.null',
          })
        ).map((row) => row.note),
      ).toEqual([NOTE])

      // A tick is the dish's own; an untick takes it back.
      await railSettled(counter.page)
      const [first] = await tickNames(card)
      await card.getByRole('button', { name: first!, exact: true }).click()
      await expect(card.locator('li[data-ticked]')).toHaveCount(1)
      await expect(card.getByRole('button', { name: /^Untick / })).toHaveCount(1)
      await card.getByRole('button', { name: /^Untick / }).click()
      await expect(card.locator('li[data-ticked]')).toHaveCount(0)
      await expect(card.getByRole('button', { name: /^Tick / })).toHaveCount(2)
    } finally {
      await closeAll([kitchen, counter], request)
    }
  },
)

test(
  'the kitchen Done fills the counter dish, a tick clears it, and a paid order finishes once, offline included',
  { tag: '@cg-on:kitchen-ready' },
  async ({ browser, request }) => {
    test.slow()
    await setSpareTillInService(request, true)
    await setSpareKind(request, 'kitchen')
    const kitchen = await openKitchen(browser, request)
    const counter = await openTill(browser, request, TILL_ONE)
    counter.page.setDefaultTimeout(30_000)
    kitchen.page.setDefaultTimeout(30_000)
    const errors: string[] = []
    for (const page of [counter.page, kitchen.page]) {
      page.on('pageerror', (error) => errors.push(error.message))
      page.on('response', (response) => {
        if (response.status() >= 500) errors.push(`HTTP ${response.status()}: ${response.url()}`)
      })
    }
    try {
      const id = await ringDishOrder(counter.page, { label: LABEL, note: NOTE, second: true })
      const card = orderCard(counter.page, id)
      const ticket = kitchen.page.locator(`[data-order-id="${id}"]`)
      await expect(ticket).toContainText(NOTE, { timeout: 30_000 })
      await expect(ticket).not.toContainText(LABEL)
      const number = (await ticket.getAttribute('data-testid'))!.replace('kitchen-card-', '')

      // Done at the kitchen fills the counter's dishes and leaves a collapsed receipt.
      await expect(card.locator('li[data-ready]')).toHaveCount(0)
      await ticket.getByRole('button', { name: /^Ready order / }).click()
      const receipt = kitchen.page.getByTestId(`kitchen-done-${number}-1`)
      await expect(receipt).toBeVisible()
      await receipt.getByRole('button', { name: /^Expand done order / }).click()
      await expect(receipt).toContainText(NOTE)
      await expect(card.locator('li[data-ready]')).toHaveCount(2)

      // Pay, then tick one dish while online: its fill clears, the other stays.
      await payCard(counter.page, card)
      const dishes = await tickNames(card)
      expect(dishes).toHaveLength(2)
      await card.getByRole('button', { name: dishes[0]!, exact: true }).click()
      await expect(card.locator('li[data-ready]')).toHaveCount(1)
      await expect(card.locator('li[data-ticked]')).toHaveCount(1)

      // Hand the last one over offline. The command waits on the device and
      // settles once: one prepared order, one bill, no label left behind.
      await counter.context.setOffline(true)
      await card.getByRole('button', { name: dishes[1]!, exact: true }).first().click()
      await expect(card).toHaveCount(0)
      await counter.context.setOffline(false)
      await expect
        .poll(
          async () =>
            (
              await rows<{ prepared_at: string | null }>(request, 'orders', {
                id: `eq.${id}`,
                select: 'prepared_at',
              })
            )[0]?.prepared_at !== null,
          { timeout: 60_000 },
        )
        .toBe(true)
      await expectOneBill(request, id)
      await expect.poll(async () => (await labelsOf(request, id)).length).toBe(0)
      await expect(kitchen.page.locator(`[data-order-id="${id}"]`)).toHaveCount(0, {
        timeout: 30_000,
      })
      expect(errors).toEqual([])
    } finally {
      await closeAll([kitchen, counter], request)
    }
  },
)

test(
  'food added after Ready arrives as a later ticket, and Undo puts the first back',
  { tag: '@cg-on:kitchen-ready' },
  async ({ browser, request }) => {
    test.slow()
    await setSpareTillInService(request, true)
    await setSpareKind(request, 'kitchen')
    const kitchen = await openKitchen(browser, request)
    const counter = await openTill(browser, request, TILL_ONE)
    counter.page.setDefaultTimeout(30_000)
    kitchen.page.setDefaultTimeout(30_000)
    try {
      const id = await ringDishOrder(counter.page, { note: NOTE })
      const card = orderCard(counter.page, id)
      const first = kitchen.page.locator(`[data-order-id="${id}"]`)
      await expect(first).toContainText(NOTE, { timeout: 30_000 })
      const number = (await first.getAttribute('data-testid'))!.replace('kitchen-card-', '')
      await first.getByRole('button', { name: /^Ready order / }).click()
      const receipt = kitchen.page.getByTestId(`kitchen-done-${number}-1`)
      await expect(receipt).toBeVisible()
      await expect(card.locator('li[data-ready]')).toHaveCount(1)

      // More food on the same order: a new ticket, #N · 2, carrying only it.
      await railSettled(counter.page)
      await card.getByRole('button', { name: /^More actions for / }).click()
      await counter.page.getByRole('menuitem', { name: 'Edit', exact: true }).click()
      await counter.page.getByRole('button', { name: CLASSIC, exact: true }).click()
      await counter.page.getByRole('button', { name: 'Save', exact: true }).click()
      const later = kitchen.page.getByTestId(`kitchen-card-${number}`)
      await expect(later).toContainText('· 2', { timeout: 30_000 })
      await expect(later).not.toContainText(NOTE)
      await expect(receipt).toBeVisible()
      // What was Ready stays Ready on the counter; the new dish is waiting.
      await expect(card.locator('li[data-ready]')).toHaveCount(1)

      // Undo takes the first Ready back: no fill, and the noted food is owed again.
      await receipt.getByRole('button', { name: /^Ready order / }).click()
      await expect(card.locator('li[data-ready]')).toHaveCount(0, { timeout: 30_000 })
      await expect(kitchen.page.getByTestId(`kitchen-card-${number}`)).toContainText(NOTE, {
        timeout: 30_000,
      })

      // And Ready again fills both dishes.
      await kitchen.page
        .getByTestId(`kitchen-card-${number}`)
        .getByRole('button', { name: /^Ready order / })
        .click()
      await expect(card.locator('li[data-ready]')).toHaveCount(2, { timeout: 30_000 })
    } finally {
      await closeAll([kitchen, counter], request)
    }
  },
)

test(
  'turning dish ticks off mid-order finishes it on the old counter exactly once and the old kitchen stays quiet',
  { tag: '@cg-round-trip:dish-ticks' },
  async ({ browser, request }) => {
    test.slow()
    await setSpareTillInService(request, true)
    await setSpareKind(request, 'kitchen')
    const kitchen = await openKitchen(browser, request)
    const counter = await openTill(browser, request, TILL_ONE)
    counter.page.setDefaultTimeout(30_000)
    kitchen.page.setDefaultTimeout(30_000)
    try {
      // New work on the new path: a label, a note, an ACK, one dish ticked.
      const id = await ringDishOrder(counter.page, { label: LABEL, note: NOTE, second: true })
      const ticket = kitchen.page.locator(`[data-order-id="${id}"]`)
      await expect(ticket).toContainText(NOTE, { timeout: 30_000 })
      await ticket.getByRole('button', { name: /^ACK order / }).click()
      await expect(ticket).toHaveAttribute('data-state', 'quiet')
      await railSettled(counter.page)
      const dishes = await tickNames(orderCard(counter.page, id))
      await orderCard(counter.page, id)
        .getByRole('button', { name: dishes[0]!, exact: true })
        .click()
      await expect(orderCard(counter.page, id).locator('li[data-ticked]')).toHaveCount(1)
      // Wait for the tick to reach the database before the gate turns under it.
      await expect(counter.page.getByTestId('sync-indicator').first()).toHaveAttribute(
        'data-sync',
        'synced',
        { timeout: 60_000 },
      )

      // The gate turns off. Both tablets hear it and reload into the old screens.
      await turnGate(request, DISH_TICKS, false)
      await hearTurn(counter.page, [DISH_TICKS])
      await hearTurn(kitchen.page, [DISH_TICKS])
      await expect(counter.page.getByTestId('menu-grid')).toBeVisible()
      await expect(kitchen.page.getByRole('heading', { name: TILL_TWO.label })).toBeVisible()

      // The old kitchen shows the acknowledged order in full and quiet: nothing rings.
      const oldTicket = kitchen.page.locator(`[data-order-id="${id}"]`)
      await expect(oldTicket).toBeVisible({ timeout: 30_000 })
      await expect(oldTicket).toHaveAttribute('data-state', 'quiet')
      await expect(oldTicket).toContainText(CLASSIC)
      await expect(oldTicket).toContainText(MAYO)
      await expect(oldTicket.getByRole('button')).toHaveCount(0)

      // The old counter reads the half-ticked order as not prepared; finish it
      // the old way: Prepared, then Paid.
      const card = orderCard(counter.page, id)
      await expect(card).toBeVisible({ timeout: 30_000 })
      await expect(card.getByRole('button', { name: /^(Tick|Untick) / })).toHaveCount(0)
      await railSettled(counter.page)
      await card.getByRole('button', { name: 'Prepared', exact: true, pressed: false }).click()
      await expect(oldTicket).toHaveCount(0, { timeout: 30_000 })
      await payCard(counter.page, card)
      await expect(card).toHaveCount(0, { timeout: 30_000 })

      await expect
        .poll(
          async () =>
            (
              await rows<{ prepared_at: string | null }>(request, 'orders', {
                id: `eq.${id}`,
                select: 'prepared_at',
              })
            )[0]?.prepared_at !== null,
          { timeout: 60_000 },
        )
        .toBe(true)
      await expectOneBill(request, id)
    } finally {
      await turnEveryGateOn()
      await closeAll([kitchen, counter], request)
    }
  },
)

test(
  'turning kitchen ready off after a Done leaves the dishes to tick, the kitchen quiet, and one bill',
  { tag: '@cg-round-trip:kitchen-ready' },
  async ({ browser, request }) => {
    test.slow()
    await setSpareTillInService(request, true)
    await setSpareKind(request, 'kitchen')
    const kitchen = await openKitchen(browser, request)
    const counter = await openTill(browser, request, TILL_ONE)
    counter.page.setDefaultTimeout(30_000)
    kitchen.page.setDefaultTimeout(30_000)
    try {
      // New work: a noted order, Done at the kitchen, the counter's dishes filled.
      const id = await ringDishOrder(counter.page, { label: LABEL, note: NOTE, second: true })
      const ticket = kitchen.page.locator(`[data-order-id="${id}"]`)
      await expect(ticket).toContainText(NOTE, { timeout: 30_000 })
      await ticket.getByRole('button', { name: /^Ready order / }).click()
      await expect(orderCard(counter.page, id).locator('li[data-ready]')).toHaveCount(2, {
        timeout: 30_000,
      })

      // Kitchen ready turns off, dish ticks stays on.
      await turnGate(request, KITCHEN_READY, false)
      await hearTurn(counter.page, [KITCHEN_READY])
      await hearTurn(kitchen.page, [KITCHEN_READY])
      await expect(counter.page.getByTestId('menu-grid')).toBeVisible()
      await expect(kitchen.page.getByRole('heading', { name: TILL_TWO.label })).toBeVisible()

      // The kitchen has no Done to press and no receipt, and the food it made
      // is not owed again: nothing rings. The counter reads the dishes as
      // plain, unticked dishes, with no fill.
      await expect(kitchen.page.getByRole('button', { name: /^Ready order / })).toHaveCount(0)
      await expect(kitchen.page.locator(`[data-order-id="${id}"]`)).toHaveCount(0)
      const card = orderCard(counter.page, id)
      await expect(card).toBeVisible({ timeout: 30_000 })
      await expect(card.locator('li[data-ready]')).toHaveCount(0)
      await expect(card.getByRole('button', { name: /^Tick / })).toHaveCount(2)

      // Finish it: pay, tick both dishes, and it settles once.
      await payCard(counter.page, card)
      for (const dish of await tickNames(card)) {
        await card.getByRole('button', { name: dish, exact: true }).first().click()
      }
      await expect(card).toHaveCount(0, { timeout: 30_000 })
      await expect
        .poll(
          async () =>
            (
              await rows<{ prepared_at: string | null }>(request, 'orders', {
                id: `eq.${id}`,
                select: 'prepared_at',
              })
            )[0]?.prepared_at !== null,
          { timeout: 60_000 },
        )
        .toBe(true)
      await expectOneBill(request, id)
      await expect(kitchen.page.locator(`[data-order-id="${id}"]`)).toHaveCount(0)
    } finally {
      await turnEveryGateOn()
      await closeAll([kitchen, counter], request)
    }
  },
)

test(
  'ACK answers in the counter slot, a saved filter changes only the view, a tick clears the kitchen, and losing sync says so',
  { tag: '@cg-on:dish-ticks' },
  async ({ browser, request }) => {
    test.slow()
    await setSpareTillInService(request, true)
    await setSpareKind(request, 'kitchen')
    const kitchen = await openKitchen(browser, request)
    const counter = await openTill(browser, request, TILL_ONE)
    try {
      const only = async (category: 'Shawarma' | 'Burgers') => {
        await kitchen.page.getByRole('button', { name: /^Filter: / }).click()
        const dialog = kitchen.page.getByRole('dialog')
        await dialog.getByRole('radio', { name: 'Only these' }).click()
        for (const choice of ['Shawarma', 'Burgers']) {
          await dialog
            .getByRole('checkbox', { name: new RegExp(choice, 'i') })
            .setChecked(choice === category)
        }
        await dialog.getByRole('button', { name: 'Save' }).click()
        await expect(kitchen.page.getByTestId('kitchen-filter-summary')).toHaveText(
          `Only ${category}`,
        )
      }
      await only('Shawarma')

      const id = await ringDishOrder(counter.page, {})
      const ticket = kitchen.page.locator(`[data-order-id="${id}"]`)
      await expect(ticket).toBeVisible({ timeout: 30_000 })
      await expect(ticket).toHaveAttribute('data-state', 'new')

      // The counter's slot for this kitchen: sent, then acknowledged by its ACK.
      const card = orderCard(counter.page, id)
      await expect(card.getByLabel(`${TILL_TWO.label}: sent`, { exact: true })).toBeVisible({
        timeout: 30_000,
      })
      await ticket.getByRole('button', { name: /^ACK order / }).click()
      await expect(ticket).toHaveAttribute('data-state', 'quiet')
      const acknowledged = card.getByLabel(`${TILL_TWO.label}: acknowledged`, { exact: true })
      await expect(acknowledged).toBeVisible({ timeout: 30_000 })

      // A saved filter changes only the view: hide the shawarma, show it again.
      await only('Burgers')
      await expect(ticket).toHaveCount(0)
      await only('Shawarma')
      await expect(ticket).toHaveAttribute('data-state', 'quiet')
      await expect(acknowledged).toBeVisible()

      // Ticking the dish takes the order off the kitchen, with no further ACK.
      await railSettled(counter.page)
      await card.getByRole('button', { name: /^Tick / }).click()
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
      await closeAll([kitchen, counter], request)
    }
  },
)
