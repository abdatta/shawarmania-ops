import { execSync } from 'node:child_process'

import {
  expect,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test'

/**
 * The tills of the local stack, shared by the specs that drive more than one.
 *
 * Moved out of `billing-two-tablets.spec.ts` when a second spec needed the same
 * spare till (each-outlet-chooses-how-it-serves, #60): two copies of the code
 * that brings a till into service would drift, and the one that did not reset
 * its shift is the bug the comment in `setSpareTillInService` records.
 */

export const PASSWORD = 'shawarmania-local'
export const SUPABASE_URL = process.env['VITE_SUPABASE_URL'] ?? 'http://127.0.0.1:54321'
// Supabase CLI's public local anon key. Identical in every local stack, and no
// authority without an authenticated RLS session.
export const LOCAL_ANON_KEY =
  process.env['VITE_SUPABASE_ANON_KEY'] ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
export const AFTER_LOCAL_ACCEPTANCE_MS = 6_500

export const TILL_ONE = { alias: 'tablet.kalyani', label: 'Kalyani counter tablet' }
export const TILL_TWO = { alias: 'tablet.kalyani.two', label: 'Kalyani second counter' }

export const OUTLET_KALYANI = '00000000-0000-4000-a000-000000000001'
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
export function serviceRoleKey(): string {
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
export async function setSpareTillInService(request: APIRequestContext, inService: boolean) {
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
export async function openTill(
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
