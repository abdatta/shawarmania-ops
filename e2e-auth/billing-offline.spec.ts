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
const AFTER_UNDO_MS = 6_500

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
  // network. The queue is IndexedDB-backed; the app shell is what lets a reload
  // reach the honest "cannot confirm this tablet" boundary while offline.
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
  await dialog.getByRole('button', { name: 'Mark Paid', exact: true }).click()
  await expect(page.getByTestId('bill-total')).toHaveText('₹0')
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
  await page.waitForTimeout(AFTER_UNDO_MS)

  await page.getByRole('button', { name: 'Finish day' }).click()
  await expect(page.getByRole('alert')).toContainText(
    /cannot finish|still waiting|reconnect|unresolved/i,
  )

  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByText('Loading the app…')).toBeVisible()
  await expect(page.getByTestId('settle')).toHaveCount(0)

  await restoreOnlineCounter(context, page)
  await expect(page.getByTestId('sync-indicator').first()).toHaveAttribute('data-sync', 'synced', {
    timeout: 20_000,
  })
  await expect
    .poll(() => billCount(request, managerToken, offlineCustomer), { timeout: 15_000 })
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
})
