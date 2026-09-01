import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from '@playwright/test'

const PASSWORD = 'shawarmania-local'
const SUPABASE_URL = process.env['VITE_SUPABASE_URL'] ?? 'http://127.0.0.1:54321'
// Supabase CLI's public local anon key. It is identical in every local stack
// and has no authority without an authenticated RLS session.
const LOCAL_ANON_KEY =
  process.env['VITE_SUPABASE_ANON_KEY'] ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const AFTER_LOCAL_ACCEPTANCE_MS = 6_500
/**
 * How long a resumed counter may take to fill in. Each remembered read runs its
 * request first and falls back only once the browser has given up on it, so the
 * menu arrives around seven seconds after a cold start rather than at once.
 */
const OFFLINE_READ_MS = 30_000

async function signInSeededTablet(page: Page, request: APIRequestContext) {
  // The local seed already represents an enrolled tablet. Put that synthetic
  // device's long-lived session where the setup flow would have put it; the
  // counter itself never renders a password field.
  const response = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: LOCAL_ANON_KEY },
    data: {
      email: 'tablet.kalyani@login.shawarmania.invalid',
      password: PASSWORD,
    },
  })
  expect(response.ok()).toBe(true)
  const session = (await response.json()) as Record<string, unknown>
  await page.addInitScript((value) => {
    localStorage.setItem('shawarmania.auth', JSON.stringify(value))
  }, session)

  await page.goto('counter')
  await expect(page).toHaveURL(/\/counter$/)
  await expect(page.getByText('Kalyani counter tablet', { exact: true })).toBeVisible()
  await expect(page.getByTestId('menu-grid')).toBeVisible()

  // Ensure the next navigation is controlled before deliberately losing the
  // network. The queue is IndexedDB-backed, and since extended-offline-billing
  // the app shell reopens this same counter from its resume record rather than
  // reaching the "cannot confirm this tablet" boundary.
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload()
  await expect(page.getByTestId('menu-grid')).toBeVisible()
}

async function markPaid(page: Page, customerName: string) {
  await page.getByRole('button', { name: 'Classic Chicken Shawarma', exact: true }).click()
  await page.getByPlaceholder('Customer name').fill(customerName)
  await page.getByTestId('settle').click()
  const dialog = page.getByRole('dialog', { name: 'Record payment' })
  await dialog.getByRole('button', { name: 'Cash', exact: true }).click()
  await dialog.getByRole('button', { name: 'Paid', exact: true }).click()
  // Durable locally: the composer gives way whether or not the backend is
  // reachable, because acceptance happened at IndexedDB. Offline the money
  // list itself cannot load — it needs the network — so local acceptance is
  // read from the composer's giving way and the queue counter.
  await expect(page.locator('dialog[open]')).toHaveCount(0)
  await expect(page.getByTestId('bill-total')).toHaveCount(0)
  await expect(page.getByTestId('settled-confirmation')).toHaveCount(0)
}

async function managerAccessToken(request: APIRequestContext): Promise<string> {
  const response = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: LOCAL_ANON_KEY },
    data: {
      email: 'admin.kalyani@login.shawarmania.invalid',
      password: PASSWORD,
    },
  })
  expect(response.ok()).toBe(true)
  const body = (await response.json()) as { access_token: string }
  return body.access_token
}

async function billCount(
  request: APIRequestContext,
  accessToken: string,
  customerName: string,
): Promise<number> {
  const response = await request.get(`${SUPABASE_URL}/rest/v1/bills`, {
    headers: {
      apikey: LOCAL_ANON_KEY,
      authorization: `Bearer ${accessToken}`,
      prefer: 'count=exact',
      range: '0-0',
    },
    params: {
      select: 'id',
      customer_name: `eq.${customerName}`,
    },
  })
  expect(response.ok()).toBe(true)
  const range = response.headers()['content-range']
  return Number(range?.split('/')[1] ?? 0)
}

async function billId(
  request: APIRequestContext,
  accessToken: string,
  customerName: string,
): Promise<string | null> {
  const response = await request.get(`${SUPABASE_URL}/rest/v1/bills`, {
    headers: {
      apikey: LOCAL_ANON_KEY,
      authorization: `Bearer ${accessToken}`,
    },
    params: {
      select: 'id',
      customer_name: `eq.${customerName}`,
      limit: '1',
    },
  })
  expect(response.ok()).toBe(true)
  const rows = (await response.json()) as { id: string }[]
  return rows[0]?.id ?? null
}

async function correctionCount(
  request: APIRequestContext,
  accessToken: string,
  targetBillId: string,
): Promise<number> {
  const response = await request.get(`${SUPABASE_URL}/rest/v1/bill_payment_corrections`, {
    headers: {
      apikey: LOCAL_ANON_KEY,
      authorization: `Bearer ${accessToken}`,
      prefer: 'count=exact',
      range: '0-0',
    },
    params: {
      select: 'id',
      bill_id: `eq.${targetBillId}`,
    },
  })
  expect(response.ok()).toBe(true)
  const range = response.headers()['content-range']
  return Number(range?.split('/')[1] ?? 0)
}

async function effectiveTender(
  request: APIRequestContext,
  accessToken: string,
  targetBillId: string,
): Promise<string[]> {
  const response = await request.get(`${SUPABASE_URL}/rest/v1/effective_bill_payments`, {
    headers: {
      apikey: LOCAL_ANON_KEY,
      authorization: `Bearer ${accessToken}`,
    },
    params: {
      select: 'method',
      bill_id: `eq.${targetBillId}`,
      order: 'method.asc',
    },
  })
  expect(response.ok()).toBe(true)
  const rows = (await response.json()) as { method: string }[]
  return rows.map(({ method }) => method)
}

async function changeLatestCashBillToUpi(page: Page, customerName: string) {
  const paidBill = page.locator('details').filter({ hasText: customerName }).first()
  await paidBill.locator('summary').click()
  // `Edit (5 min)` / `Edit (59 sec)` — the countdown label from
  // `paymentEditLabel`, which is the button's whole accessible name.
  await paidBill.getByRole('button', { name: /^Edit \(/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Record payment' })
  await dialog.getByRole('button', { name: 'Remove Cash payment' }).click()
  await dialog.getByRole('button', { name: 'UPI', exact: true }).click()
  await dialog.getByRole('button', { name: 'Save payment' }).click()
}

async function restoreOnlineCounter(context: BrowserContext, page: Page) {
  await context.setOffline(false)
  await page.reload()
  await expect(page.getByTestId('menu-grid')).toBeVisible()
}

test('the real tablet survives network loss and settles each local acceptance exactly once', async ({
  page,
  context,
  request,
}) => {
  test.setTimeout(90_000)
  await signInSeededTablet(page, request)

  const run = Date.now().toString(36)
  const offlineCustomer = `E2E offline ${run}`
  const lostResponseCustomer = `E2E lost response ${run}`
  const managerToken = await managerAccessToken(request)

  // Backend disappears before local acceptance. The form still clears only
  // after IndexedDB commits, and the pending command survives a browser reload.
  await context.setOffline(true)
  await markPaid(page, offlineCustomer)
  await expect(page.getByTestId('sync-indicator').first()).toHaveAttribute('data-sync', 'pending')
  // Correct the tender while the parent payment is still local. Both commands
  // must survive restart and drain in dependency order.
  await changeLatestCashBillToUpi(page, offlineCustomer)
  await expect(page.getByText('Payment updated.')).toBeVisible()
  await page.waitForTimeout(AFTER_LOCAL_ACCEPTANCE_MS)

  await page.getByRole('button', { name: 'Finish day' }).click()
  const finish = page.getByRole('dialog', { name: 'Finish day' })
  await expect(finish.getByText(/authoritative server state is unavailable/i)).toBeVisible()
  await expect(finish.getByText(/actions? still sending/i)).toBeVisible()
  await expect(finish.getByRole('button', { name: 'Check again' })).toHaveCount(0)
  await expect(finish.getByRole('button', { name: 'Keep billing' })).toBeVisible()
  await expect(finish.getByRole('button', { name: /finish day now/i })).toHaveCount(0)

  // THE COLD START, against the real backend and with it unreachable. Before
  // extended-offline-billing this reload ended at "cannot confirm this
  // tablet"; the assertion here was that the counter did NOT come back. It
  // must now reopen from the resume record, labelled as remembered, with every
  // captured command still on the device.
  await page.reload({ waitUntil: 'domcontentloaded' })

  await expect(page.getByTestId('offline-resume-status')).toBeVisible({
    timeout: OFFLINE_READ_MS,
  })
  await expect(page.getByTestId('offline-resume-status')).toContainText(
    'Offline · last successful read',
  )
  // Every remembered read has to fail through the network stack before its
  // fallback runs, so a resumed counter fills in over several seconds rather
  // than instantly. `OFFLINE_READ_MS` is that budget, not a flake allowance.
  await expect(page.getByTestId('menu-grid')).toBeVisible({ timeout: OFFLINE_READ_MS })
  await expect(page.getByTestId('menu-as-of')).toBeVisible({ timeout: OFFLINE_READ_MS })
  await expect(page.getByTestId('pipeline-as-of')).toBeVisible({ timeout: OFFLINE_READ_MS })
  await expect(page.getByTestId('bills-as-of')).toBeVisible({ timeout: OFFLINE_READ_MS })
  await expect(page.getByRole('button', { name: 'Hand over' })).toBeDisabled()
  // Nothing was lost across the restart: both commands are still unsent, and
  // the counter says so as `stalled` rather than `pending` — a resumed tablet
  // deliberately does not drain until it has re-resolved itself online.
  await expect(page.getByTestId('sync-indicator').first()).toHaveAttribute('data-sync', 'stalled')

  // New work is still accepted after the cold start, and survives a SECOND
  // restart inside the same outage.
  const afterRestartCustomer = `E2E after restart ${run}`
  await markPaid(page, afterRestartCustomer)
  await page.waitForTimeout(AFTER_LOCAL_ACCEPTANCE_MS)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('offline-resume-status')).toBeVisible({
    timeout: OFFLINE_READ_MS,
  })
  await expect(page.getByTestId('menu-grid')).toBeVisible({ timeout: OFFLINE_READ_MS })
  await expect(page.getByTestId('sync-indicator').first()).toHaveAttribute('data-sync', 'stalled')

  // Finish Day still refuses, and says why, from the resumed counter.
  await page.getByRole('button', { name: 'Finish day' }).click()
  const offlineFinish = page.getByRole('dialog', { name: 'Finish day' })
  // The sheet drains and probes the server before it answers, and offline both
  // have to time out first.
  await expect(offlineFinish.getByText(/finish day is unavailable offline/i)).toBeVisible({
    timeout: OFFLINE_READ_MS,
  })
  await expect(offlineFinish.getByRole('button', { name: /finish day now/i })).toHaveCount(0)
  await offlineFinish.getByRole('button', { name: 'Keep billing' }).click()

  await restoreOnlineCounter(context, page)
  await expect(page.getByTestId('offline-resume-status')).toHaveCount(0)
  await expect(page.getByTestId('sync-indicator').first()).toHaveAttribute('data-sync', 'synced', {
    timeout: 20_000,
  })
  await expect
    .poll(() => billCount(request, managerToken, offlineCustomer), { timeout: 15_000 })
    .toBe(1)
  const offlineBillId = await billId(request, managerToken, offlineCustomer)
  expect(offlineBillId).not.toBeNull()
  await expect
    .poll(() => correctionCount(request, managerToken, offlineBillId!), { timeout: 15_000 })
    .toBe(1)
  await expect
    .poll(() => effectiveTender(request, managerToken, offlineBillId!), { timeout: 15_000 })
    .toEqual(['upi'])
  // Captured after the cold start, through two restarts, and still exactly one.
  await expect
    .poll(() => billCount(request, managerToken, afterRestartCustomer), { timeout: 15_000 })
    .toBe(1)

  // The server commits the next bill but its response is discarded. Delivery
  // retries the same command identity and receives exact replay, never a second
  // bill or a second outlet bill number.
  const rpcPattern = `${SUPABASE_URL}/rest/v1/rpc/pay_billing_now`
  let committed!: () => void
  const responseWasLost = new Promise<void>((resolve) => {
    committed = resolve
  })
  await page.route(rpcPattern, async (route) => {
    const response = await route.fetch()
    expect(response.ok()).toBe(true)
    committed()
    await route.abort('failed')
  })

  await markPaid(page, lostResponseCustomer)
  await responseWasLost
  await page.unroute(rpcPattern)

  await expect(page.getByTestId('sync-indicator').first()).toHaveAttribute('data-sync', 'synced', {
    timeout: 20_000,
  })
  await expect
    .poll(() => billCount(request, managerToken, lostResponseCustomer), { timeout: 15_000 })
    .toBe(1)

  // Lose the response after the correction commits as well. Retrying that
  // correction identity must replay revision 1 rather than append revision 2.
  const correctionRpcPattern = `${SUPABASE_URL}/rest/v1/rpc/correct_bill_payment`
  let correctionCommitted!: () => void
  const correctionResponseWasLost = new Promise<void>((resolve) => {
    correctionCommitted = resolve
  })
  await page.route(correctionRpcPattern, async (route) => {
    const response = await route.fetch()
    expect(response.ok()).toBe(true)
    correctionCommitted()
    await route.abort('failed')
  })

  await changeLatestCashBillToUpi(page, lostResponseCustomer)
  await correctionResponseWasLost
  await page.unroute(correctionRpcPattern)

  await expect(page.getByTestId('sync-indicator').first()).toHaveAttribute('data-sync', 'synced', {
    timeout: 20_000,
  })
  const lostResponseBillId = await billId(request, managerToken, lostResponseCustomer)
  expect(lostResponseBillId).not.toBeNull()
  await expect
    .poll(() => correctionCount(request, managerToken, lostResponseBillId!), { timeout: 15_000 })
    .toBe(1)
  await expect
    .poll(() => effectiveTender(request, managerToken, lostResponseBillId!), { timeout: 15_000 })
    .toEqual(['upi'])
})
