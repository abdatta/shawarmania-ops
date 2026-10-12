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
 * the server. #72 adds the counter's side: the bell on its card swings until the
 * kitchen presses ACK, and stops when it does. The seed's spare till is turned into a kitchen for the run and
 * put back afterwards — as a billing till, whatever happened in between.
 */

let nextCustomerDigits = Number(`9${String(Date.now()).slice(-9)}`)

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

    // An order taken at the counter arrives in the kitchen, new and alerting,
    // with no customer anywhere on the kitchen's screen.
    const id = await saveOrder(counter.page, 'Kitchen Sees This')
    const card = kitchen.page.locator(`[data-order-id="${id}"]`)
    await expect(card).toBeVisible({ timeout: 30_000 })
    await expect(card).toHaveAttribute('data-state', 'new')
    await expect(card).toContainText('Classic Chicken Shawarma')
    await expect(kitchen.page.getByText('Kitchen Sees This')).toHaveCount(0)

    // #72: the counter's card carries the kitchen's bell, swinging until the
    // kitchen answers.
    const bell = orderCard(counter.page, id).getByLabel(`${TILL_TWO.label}: sent`, { exact: true })
    await expect(bell).toBeVisible({ timeout: 30_000 })

    // ACK quiets it, and the acknowledgement is the server's.
    await card.getByRole('button', { name: /^ACK order / }).click()
    await expect(card).toHaveAttribute('data-state', 'quiet')
    // The counter hears it through the kitchen pulse, with no reload.
    const acknowledged = orderCard(counter.page, id).getByLabel(`${TILL_TWO.label}: acknowledged`, {
      exact: true,
    })
    await expect(acknowledged).toBeVisible({ timeout: 30_000 })
    await kitchen.page.reload()
    await expect(kitchen.page.locator(`[data-order-id="${id}"]`)).toHaveAttribute(
      'data-state',
      'quiet',
    )

    // The owner's sequence: a saved filter changes only the view. Hide the
    // shawarma, then show it again, without a cancellation or another ACK.
    await only('Shawarma')
    await expect(card).toHaveAttribute('data-state', 'quiet')
    await only('Burgers')
    await expect(card).toHaveCount(0)
    await expect(bell).toHaveCount(0)
    await only('Shawarma')
    await expect(card).toHaveAttribute('data-state', 'quiet')
    await expect(card.locator('..')).not.toHaveClass(/kitchen-shake/)
    await expect(card.getByRole('button', { name: /^ACK order / })).toHaveCount(0)
    await expect(acknowledged).toBeVisible()

    // Prepared at the counter takes it off the kitchen, with no ACK.
    await railSettled(counter.page)
    await orderCard(counter.page, id)
      .getByRole('button', { name: /^Tick / })
      .click()
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

test('live dish notes, Ready receipts, later tickets, Undo and offline handover reach the same order', async ({
  browser,
  request,
}, testInfo) => {
  test.slow()
  await setSpareTillInService(request, true)
  await setSpareKind(request, 'kitchen')
  const kitchen = await openKitchen(browser, request)
  const counter = await openTill(browser, request, TILL_ONE)
  const errors: string[] = []
  counter.page.setDefaultTimeout(30000)
  kitchen.page.setDefaultTimeout(15000)
  await counter.page.evaluate(() => {
    localStorage.setItem('shawarmania-demo-ready-cue', 'halo')
    window.dispatchEvent(new Event('storage'))
  })
  for (const page of [counter.page, kitchen.page]) {
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('response', (response) => {
      if (response.status() >= 500) errors.push(`HTTP ${response.status()}: ${response.url()}`)
    })
  }
  try {
    await counter.page
      .getByRole('button', { name: 'Classic Chicken Shawarma', exact: true })
      .click()
    await counter.page
      .getByRole('button', { name: 'Classic Chicken Shawarma', exact: true })
      .click()
    await counter.page.getByPlaceholder('Order Label').fill('Red shirt')
    await counter.page
      .getByRole('button', { name: 'Note for Classic Chicken Shawarma', exact: true })
      .click()
    const note = counter.page.getByRole('dialog', { name: 'Note for Classic Chicken Shawarma' })
    await note.getByRole('textbox', { name: 'Dish note' }).fill('No sauce')
    await note.getByRole('button', { name: 'Save note', exact: true }).click()
    await counter.page.getByRole('button', { name: 'Enter Customer Info', exact: true }).click()
    await counter.page
      .getByRole('dialog', { name: 'Customer' })
      .getByRole('button', { name: 'Skip', exact: true })
      .click()
    const id = await saveNewOrder(counter.page, async () => {
      await counter.page.getByRole('button', { name: 'Order', exact: true }).click()
    })
    const cooking = kitchen.page.locator(`[data-order-id="${id}"]`)
    await expect(cooking).toContainText('No sauce', { timeout: 30000 })
    await expect(cooking).not.toContainText('Red shirt')
    const number = (await cooking.getAttribute('data-testid'))!.replace('kitchen-card-', '')
    await cooking.getByRole('button', { name: /^Ready order / }).click()
    // Done is collapsed; expand to inspect its captured food.
    const receipt = kitchen.page.getByTestId(`kitchen-done-${number}-1`)
    await expect(receipt).toBeVisible({ timeout: 30000 })
    await receipt.getByRole('button', { name: /^Expand done order / }).click()
    await expect(receipt).toContainText('No sauce')
    const card = orderCard(counter.page, id)
    await expect(card.getByTestId('dish-ready-cue')).toBeVisible({ timeout: 30000 })
    await expect(card.getByTestId('dish-ready-cue')).toHaveAttribute('data-cue', 'pulse-dot')
    await expect(card.getByRole('button', { name: 'Prepared', exact: true })).toHaveCount(0)
    await expect(counter.page.locator('audio')).toHaveCount(0)
    for (const theme of ['light', 'dark'] as const) {
      for (const [name, width, height] of [
        ['tablet', 1080, 810],
        ['phone', 390, 844],
      ] as const) {
        for (const [surface, page] of [
          ['counter', counter.page],
          ['kitchen', kitchen.page],
        ] as const) {
          await page.setViewportSize({ width, height })
          await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme)
          await page.screenshot({
            path: testInfo.outputPath(`live-${surface}-${name}-${theme}.png`),
            fullPage: true,
            animations: 'disabled',
          })
          if (surface === 'counter' && name === 'phone') {
            await page.getByTestId('counter-workspace').evaluate((workspace) => {
              workspace.scrollLeft = 430
            })
            await expect
              .poll(() =>
                page
                  .getByTestId('counter-records-columns')
                  .evaluate((records) => records.scrollLeft),
              )
              .toBe(430)
            await expect(card).toBeVisible()
            await page.screenshot({
              path: testInfo.outputPath(`live-counter-phone-rail-${theme}.png`),
              fullPage: true,
              animations: 'disabled',
            })
            await page.getByTestId('counter-workspace').evaluate((workspace) => {
              workspace.scrollLeft = 0
            })
          }
        }
      }
    }
    await counter.page.setViewportSize({ width: 1280, height: 900 })
    await kitchen.page.setViewportSize({ width: 1280, height: 900 })
    await card.getByRole('button', { name: /^More actions for / }).click()
    await counter.page.getByRole('menuitem', { name: 'Edit', exact: true }).click()
    await counter.page
      .getByRole('button', { name: 'Classic Chicken Shawarma', exact: true })
      .click()
    await counter.page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(cooking).toContainText('· 2', { timeout: 30000 })
    await expect(cooking).not.toContainText('No sauce')
    await expect(receipt).toBeVisible()
    // Lowering the already-made line changes no cooking food or alert state.
    await cooking.evaluate((ticket) => ticket.setAttribute('data-food-revision-probe', 'held'))
    await card.getByRole('button', { name: /^More actions for / }).click()
    await counter.page.getByRole('menuitem', { name: 'Edit', exact: true }).click()
    await counter.page
      .getByTestId('bill-panel')
      .locator('li')
      .filter({ hasText: 'No sauce' })
      .getByRole('button', { name: 'One fewer Classic Chicken Shawarma', exact: true })
      .click()
    await counter.page.getByRole('button', { name: 'Save', exact: true }).click()
    // The visible owed food is unchanged, so wait for the revision's delivery
    // and read its new version before ACK. An ACK of the previous version is
    // intentionally refused by the database.
    await expect(counter.page.getByTestId('sync-indicator').first()).toHaveAttribute(
      'data-sync',
      'synced',
      { timeout: 60000 },
    )
    await expect(
      receipt.getByRole('list').locator('li').first().locator('span').first(),
    ).toHaveText('1', { timeout: 30000 })
    // A new shake remounts the cooking card. Its retained DOM identity proves
    // the hidden-food revision did not restart that ticket's alert.
    await expect(cooking).toHaveAttribute('data-food-revision-probe', 'held')
    await kitchen.page.reload()
    await expect(cooking).toHaveAttribute('data-state', 'new')
    await cooking.getByRole('button', { name: /^ACK order / }).click()
    await expect(cooking).toHaveAttribute('data-state', 'quiet')
    await receipt.getByRole('button', { name: /^Ready order / }).click()
    await expect(card.getByTestId('dish-ready-cue')).toHaveCount(0, { timeout: 30000 })
    await expect(cooking).toContainText('No sauce', { timeout: 30000 })
    await cooking.getByRole('button', { name: /^Ready order / }).click()
    await expect(card.getByTestId('dish-ready-cue')).toHaveCount(2, { timeout: 30000 })
    // Pay while cooking, then hand over offline. Delivery must settle once.
    await card.getByRole('button', { name: 'Paid', exact: true }).click()
    await counter.page
      .getByRole('dialog', { name: 'Receipt and points' })
      .getByRole('button', { name: 'Skip', exact: true })
      .click()
    const payment = counter.page.getByRole('dialog', { name: 'Record payment' })
    await payment.getByRole('button', { name: 'Cash', exact: true }).click()
    await payment.getByRole('button', { name: 'Paid', exact: true }).click()
    await expect(payment).toHaveCount(0)
    const ticks = card.getByRole('button', { name: /^Tick / })
    await expect(ticks.first()).toBeVisible({ timeout: 30000 })
    const dishes = await ticks.evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute('aria-label')!),
    )
    expect(dishes).toHaveLength(2)
    await counter.context.setOffline(true)
    for (const dish of dishes)
      await card.getByRole('button', { name: dish, exact: true }).first().click()
    await expect(card).toHaveCount(0, { timeout: 30000 })
    await counter.context.setOffline(false)
    const key = serviceRoleKey()
    await expect
      .poll(
        async () => {
          const result = await request.get(`${SUPABASE_URL}/rest/v1/orders`, {
            headers: { apikey: key, authorization: `Bearer ${key}` },
            params: { id: `eq.${id}`, select: 'prepared_at,label' },
          })
          const rows = (await result.json()) as {
            prepared_at: string | null
            label: string | null
          }[]
          return rows[0]?.prepared_at !== null && rows[0]?.label === null
        },
        { timeout: 60000 },
      )
      .toBe(true)
    const bills = await request.get(`${SUPABASE_URL}/rest/v1/bills`, {
      headers: { apikey: key, authorization: `Bearer ${key}` },
      params: { order_id: `eq.${id}`, select: 'id' },
    })
    expect(await bills.json()).toHaveLength(1)
    await expect(kitchen.page.locator(`[data-order-id="${id}"]`)).toHaveCount(0, { timeout: 30000 })
    expect(errors).toEqual([])
  } finally {
    await kitchen.context.close()
    await counter.context.close()
    await setSpareKind(request, 'counter')
    await setSpareTillInService(request, false)
  }
})
