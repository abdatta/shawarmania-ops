import { execSync } from 'node:child_process'

import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test'

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

const PASSWORD = 'shawarmania-local'
const SUPABASE_URL = process.env['VITE_SUPABASE_URL'] ?? 'http://127.0.0.1:54321'
// Supabase CLI's public local anon key. Identical in every local stack, and no
// authority without an authenticated RLS session.
const LOCAL_ANON_KEY =
  process.env['VITE_SUPABASE_ANON_KEY'] ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const AFTER_LOCAL_ACCEPTANCE_MS = 6_500

const TILL_ONE = { alias: 'tablet.kalyani', label: 'Kalyani counter tablet' }
const TILL_TWO = { alias: 'tablet.kalyani.two', label: 'Kalyani second counter' }

const OUTLET_KALYANI = '00000000-0000-4000-a000-000000000001'
const SPARE_TILL = '10000000-0000-4000-a000-00000000000f'
const SPARE_SHIFT = '90000000-0000-4000-a000-000000000003'
const SECOND_BILLER = '10000000-0000-4000-a000-000000000010'

/**
 * The local service-role key, discovered the way the RLS phases discover it.
 *
 * Needed for fixture setup and nothing else: bringing the seeded spare till into
 * service. It never reaches the browser -- the app under test is wired to the
 * anon key exactly as in every other spec here -- and it is discovered rather
 * than required so the suite still runs from a clean shell with the stack up.
 */
function serviceRoleKey(): string {
  const configured = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (configured) return configured
  const status = JSON.parse(
    execSync('npx supabase status -o json', { encoding: 'utf8' }),
  ) as Record<string, unknown>
  const discovered = status['SERVICE_ROLE_KEY']
  if (typeof discovered !== 'string' || discovered.length === 0) {
    throw new Error('The local Supabase service-role key could not be discovered')
  }
  return discovered
}

/** Bring the spare till into service, or put it back. */
async function setSpareTillInService(request: APIRequestContext, inService: boolean) {
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
    data: inService
      ? { removed_at: null, last_seen_at: new Date().toISOString() }
      : { removed_at: new Date().toISOString() },
  })
  expect(device.ok(), 'could not change the spare till').toBe(true)

  if (!inService) {
    // Ended rather than deleted, because bills taken during the test reference
    // this shift and money history is never removed. It is also what removal
    // does in production: the tablet goes, and its shift ends with it.
    const close = await request.patch(`${SUPABASE_URL}/rest/v1/counter_shifts`, {
      headers,
      params: { id: `eq.${SPARE_SHIFT}`, ended_at: 'is.null' },
      data: { ended_at: new Date().toISOString(), ended_reason: 'device_removed' },
    })
    expect(close.ok(), 'could not close the spare till shift').toBe(true)
    return
  }

  /*
    Every column stated, `ended_at` and `ended_reason` included.

    An upsert only writes the columns its payload carries, so omitting them left
    whatever was there — and the two-till race suite, which runs earlier on the
    same stack in CI, ends this very shift in its own teardown. The spare
    therefore came back as a tablet with a DEAD shift: the counter rendered its
    shift-request screen, which still shows the till's label, and the menu grid
    that only a live shift produces never appeared.

    It passed locally for the least useful reason available: a `db:reset`
    immediately beforehand meant the row did not exist yet, so the upsert was an
    insert. Activation has to be idempotent against any prior state, because in
    CI it never runs against a fresh one.
  */
  const shift = await request.post(`${SUPABASE_URL}/rest/v1/counter_shifts`, {
    headers: { ...headers, prefer: 'resolution=merge-duplicates,return=minimal' },
    data: {
      id: SPARE_SHIFT,
      device_id: SPARE_TILL,
      outlet_id: OUTLET_KALYANI,
      person_id: SECOND_BILLER,
      opened_at: new Date(Date.now() - 60 * 60_000).toISOString(),
      business_date: new Date().toISOString().slice(0, 10),
      expires_at: new Date(Date.now() + 6 * 60 * 60_000).toISOString(),
      ended_at: null,
      ended_reason: null,
    },
  })
  expect(shift.ok(), 'could not open a shift on the spare till').toBe(true)
}

/**
 * A seeded tablet in its own browser context.
 *
 * Its own context rather than its own page, deliberately: two tablets sharing a
 * context would share one origin's IndexedDB and one service worker, which is
 * exactly the thing this change promises they do not do.
 */
async function openTill(
  browser: Browser,
  request: APIRequestContext,
  till: { alias: string; label: string },
): Promise<{ context: BrowserContext; page: Page }> {
  const response = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: LOCAL_ANON_KEY },
    data: { email: `${till.alias}@login.shawarmania.invalid`, password: PASSWORD },
  })
  expect(response.ok(), `${till.alias} could not sign in`).toBe(true)
  const session = (await response.json()) as Record<string, unknown>

  const context = await browser.newContext()
  const page = await context.newPage()
  await page.addInitScript((value) => {
    localStorage.setItem('shawarmania.auth', JSON.stringify(value))
  }, session)

  await page.goto('counter')
  await expect(page).toHaveURL(/\/counter$/)
  // Each till says which till it is. With one tablet this was decoration; with
  // two it is the only thing distinguishing the screens.
  await expect(page.getByText(till.label, { exact: true })).toBeVisible()
  await expect(page.getByTestId('menu-grid')).toBeVisible()
  await page.evaluate(() => navigator.serviceWorker.ready)
  return { context, page }
}

async function markPaid(page: Page, customerName: string) {
  await page.getByRole('button', { name: 'Classic Chicken Shawarma', exact: true }).click()
  await page.getByPlaceholder('Customer name').fill(customerName)
  await page.getByTestId('settle').click()
  const dialog = page.getByRole('dialog', { name: 'Record payment' })
  await dialog.getByRole('button', { name: 'Cash', exact: true }).click()
  await dialog.getByRole('button', { name: 'Paid', exact: true }).click()
  await expect(page.locator('dialog[open]')).toHaveCount(0)
  await expect(page.getByTestId('bill-total')).toHaveCount(0)
}

async function saveOrder(page: Page, customerName: string) {
  await page.getByRole('button', { name: 'Classic Chicken Shawarma', exact: true }).click()
  await page.getByPlaceholder('Customer name').fill(customerName)
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
    // the counter that took it, and every control on it stands down. Without
    // the till chip this card is indistinguishable from its own work whenever
    // one person holds both shifts.
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
    await expect(neighbourCard.getByRole('button', { name: 'Prepared' })).toBeDisabled()

    // And the same order is still fully actionable on the till that took it,
    // which is the assertion that keeps the gate from being "disable
    // everything".
    const ownCard = cardFor(one.page, 'Kitchen Owes This')
    await expect(ownCard).toBeVisible({ timeout: 20_000 })
    await expect(ownCard.getByRole('button', { name: 'Prepared' })).toBeEnabled()
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
