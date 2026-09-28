import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

import {
  AFTER_LOCAL_ACCEPTANCE_MS,
  LOCAL_ANON_KEY,
  PASSWORD,
  SUPABASE_URL,
  TILL_ONE,
  TILL_TWO,
  openTill,
  setSpareTillInService,
} from './tills'

/**
 * Two tablets at one outlet, in two real browsers, against the real backend.
 *
 * This is the phase gate for `multiple-billing-devices` and it is the only layer
 * that can fail for the right reason. pgTAP proves the database refuses what it
 * should; the REST races prove the allocator serializes. Neither drives the app,
 * and the app is where the two tablets are two independent IndexedDB stores,
 * two service workers, two drain leaders and two people looking at the same
 * outlet's pipeline.
 *
 * **The two-till shop is built here, not seeded.** The seed holds one active
 * tablet per outlet, because that is what the business runs, what a third outlet
 * would open with, and therefore the shape every other suite must keep seeing --
 * `billing-offline.spec.ts` above all, whose whole subject is one tablet
 * surviving an outage and which would otherwise be running at a two-till outlet
 * without saying so. A spare tablet is seeded removed; this spec brings it into
 * service and puts it back afterwards.
 */

/*
  Identify the customer from the dialog's keypad, which is the only way a
  number reaches a bill now. Each call takes its own number, so the customers
  these specs create never collide — and the bill still carries the name the
  assertions below find it by.

  Offline this is the no-match path: the lookup cannot reach the directory, the
  dialog reads exactly as it does for a number nobody has used, and the sale
  carries on. The customer itself is created by the server when the command
  drains, which is the whole point of the change these specs now exercise.
*/
let nextCustomerDigits = 9000004000

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

async function markPaid(page: Page, customerName: string) {
  await page.getByRole('button', { name: 'Classic Chicken Shawarma', exact: true }).click()
  await identifyCustomer(page, customerName)
  await page.getByTestId('settle').click()
  const dialog = page.getByRole('dialog', { name: 'Record payment' })
  await dialog.getByRole('button', { name: 'Cash', exact: true }).click()
  await dialog.getByRole('button', { name: 'Paid', exact: true }).click()
  await expect(page.locator('dialog[open]')).toHaveCount(0)
  await expect(page.getByTestId('bill-total')).toHaveCount(0)
}

async function saveOrder(page: Page, customerName: string) {
  await page.getByRole('button', { name: 'Classic Chicken Shawarma', exact: true }).click()
  await identifyCustomer(page, customerName)
  await page.getByRole('button', { name: 'Order', exact: true }).click()
  await expect(page.getByTestId('bill-total')).toHaveCount(0)
}

async function managerToken(request: APIRequestContext): Promise<string> {
  const response = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: LOCAL_ANON_KEY },
    data: { email: 'admin.kalyani@login.shawarmania.invalid', password: PASSWORD },
  })
  expect(response.ok()).toBe(true)
  return ((await response.json()) as { access_token: string }).access_token
}

/** Bills for these customers, as the manager reads them: number and till. */
async function billsFor(
  request: APIRequestContext,
  token: string,
  customerNames: string[],
): Promise<{ bill_number: number; counter_device_id: string; customer_name: string }[]> {
  const response = await request.get(`${SUPABASE_URL}/rest/v1/bills`, {
    headers: { apikey: LOCAL_ANON_KEY, authorization: `Bearer ${token}` },
    params: {
      select: 'bill_number,counter_device_id,customer_name',
      customer_name: `in.(${customerNames.join(',')})`,
      order: 'bill_number.asc',
    },
  })
  expect(response.ok()).toBe(true)
  return (await response.json()) as {
    bill_number: number
    counter_device_id: string
    customer_name: string
  }[]
}

test('two tablets bill one outlet at once, own their own orders, and neither drains the other', async ({
  browser,
  request,
}) => {
  test.slow()

  await setSpareTillInService(request, true)

  const one = await openTill(browser, request, TILL_ONE)
  const two = await openTill(browser, request, TILL_TWO)
  const token = await managerToken(request)

  try {
    // ---------------------------------------------------------------------
    // 1. Both tills pay at the same moment.
    //
    // Submitted together so the per-outlet allocator is genuinely contended
    // through the whole app rather than one request at a time.
    await Promise.all([markPaid(one.page, 'Concurrent One'), markPaid(two.page, 'Concurrent Two')])
    await one.page.waitForTimeout(AFTER_LOCAL_ACCEPTANCE_MS)

    const paid = await billsFor(request, token, ['Concurrent One', 'Concurrent Two'])
    expect(paid).toHaveLength(2)
    // Distinct, sequential, and one per till: a shared counter would have
    // produced a duplicate, a gap, or both bills on one device.
    expect(new Set(paid.map((bill) => bill.bill_number)).size).toBe(2)
    expect(paid[1]!.bill_number - paid[0]!.bill_number).toBe(1)
    expect(new Set(paid.map((bill) => bill.counter_device_id)).size).toBe(2)

    // ---------------------------------------------------------------------
    // 2. The neighbour sees the order, is told whose it is, and cannot act.
    await saveOrder(one.page, 'Kitchen Owes This')

    // The outlet's pipeline, on the other till: the order is there, named with
    // the counter that took it, and its two facts are *printed* rather than
    // offered. Without the till chip this card is indistinguishable from its own
    // work whenever one person holds both shifts.
    /*
      Scoped to THIS order's card, not to the rail.

      The rail is the outlet's, so it carries whatever else the outlet has open
      — including an order left by the spec that runs before this one. A
      rail-wide locator for `Prepared` therefore matched two buttons and failed
      on strict mode, with both of them correctly disabled: the assertion was
      right and the locator was sloppy. Naming the card is also what the
      assertion means, since the claim is about one order rather than about
      every control on screen.
    */
    const cardFor = (page: Page, customer: string) =>
      page
        .getByTestId('counter-activity-rail')
        .locator('[data-testid^="open-order-"]')
        .filter({ hasText: customer })

    const neighbourCard = cardFor(two.page, 'Kitchen Owes This')
    await expect(neighbourCard).toBeVisible({ timeout: 20_000 })
    await expect(neighbourCard).toContainText(`on ${TILL_ONE.label}`)
    /*
      Drawn without control chrome rather than as a dimmed button (#55): a
      disabled button is a promise the screen is refusing to keep, and billers
      read it as breakage. So the assertion is that there is no control here at
      all — just the fact, with no pressed state to misreport to a screen
      reader — which is a stronger claim than "disabled" was.
    */
    await expect(neighbourCard.getByRole('button', { name: 'Prepared' })).toHaveCount(0)
    const neighbourFact = neighbourCard.getByText('Prepared', { exact: true })
    await expect(neighbourFact).toBeVisible()
    await expect(neighbourFact).toHaveAttribute('data-fact', 'true')
    await expect(neighbourFact).not.toHaveAttribute('aria-pressed', /.*/)

    // And the same order is still fully actionable on the till that took it,
    // which is the assertion that keeps the gate from being "stand everything
    // down".
    const ownCard = cardFor(one.page, 'Kitchen Owes This')
    await expect(ownCard).toBeVisible({ timeout: 20_000 })
    const ownControl = ownCard.getByRole('button', { name: 'Prepared' })
    await expect(ownControl).toBeEnabled()
    await expect(ownControl).toHaveAttribute('aria-pressed', 'false')
    // Its own card names no till: the order is this counter's own work.
    await expect(ownCard).not.toContainText(`on ${TILL_ONE.label}`)

    // ---------------------------------------------------------------------
    // 3. One till loses the network while the other keeps trading.
    await two.context.setOffline(true)
    await markPaid(two.page, 'Captured Offline')
    // Accepted locally, so it is not on the server yet.
    expect(await billsFor(request, token, ['Captured Offline'])).toHaveLength(0)

    // The online till is not blocked by its neighbour's outage, and its work
    // reaches the server while the other's waits.
    await markPaid(one.page, 'Traded Meanwhile')
    await one.page.waitForTimeout(AFTER_LOCAL_ACCEPTANCE_MS)
    expect(await billsFor(request, token, ['Traded Meanwhile'])).toHaveLength(1)
    // And the offline till's work is still nobody else's to deliver.
    expect(await billsFor(request, token, ['Captured Offline'])).toHaveLength(0)

    // ---------------------------------------------------------------------
    // 4. The offline till reconnects and drains its own queue.
    await two.context.setOffline(false)
    await expect
      .poll(async () => (await billsFor(request, token, ['Captured Offline'])).length, {
        timeout: 60_000,
      })
      .toBe(1)

    // ---------------------------------------------------------------------
    // 5. Every bill exists exactly once, numbered in acceptance order.
    const all = await billsFor(request, token, [
      'Concurrent One',
      'Concurrent Two',
      'Captured Offline',
      'Traded Meanwhile',
    ])
    expect(all).toHaveLength(4)
    const numbers = all.map((bill) => bill.bill_number)
    expect(new Set(numbers).size).toBe(4)

    // The bill captured offline synced last, so it carries the HIGHEST number
    // despite having been taken before 'Traded Meanwhile'. That is the
    // documented consequence of numbering by acceptance, and asserting it here
    // is what stops somebody "fixing" it into event order later.
    const byName = new Map(all.map((bill) => [bill.customer_name, bill.bill_number]))
    expect(byName.get('Captured Offline')!).toBeGreaterThan(byName.get('Traded Meanwhile')!)
  } finally {
    await one.context.close()
    await two.context.close()
    // Put the shop back the way the seed left it, so a later spec in this file
    // -- or a rerun without a reset -- still sees one till per outlet.
    await setSpareTillInService(request, false)
  }
})
