import { type APIRequestContext } from '@playwright/test'
import { expect, test } from './test'

import { SUPABASE_URL, TILL_ONE, openTill, serviceRoleKey } from './tills'

/**
 * This change's own two gates on a real counter (a-release-can-be-switched-off,
 * D13, D16): with the probe on, its code is in the counter's build code; with
 * tablet health on, the counter reports its build, the gates it booted with and
 * a minute's request counts — and nothing that could carry a phone number, a
 * name or an amount. With tablet health off, it reports nothing.
 */

/** The seeded Kalyani counter tablet's device id, which its health row is keyed by. */
const TILL_ONE_DEVICE = '10000000-0000-4000-a000-000000000004'

function serviceHeaders() {
  const key = serviceRoleKey()
  return { apikey: key, authorization: `Bearer ${key}` }
}

async function healthRow(request: APIRequestContext): Promise<Record<string, unknown> | null> {
  const response = await request.get(`${SUPABASE_URL}/rest/v1/device_health`, {
    headers: serviceHeaders(),
    params: { device_id: `eq.${TILL_ONE_DEVICE}`, select: '*' },
  })
  expect(response.ok(), 'could not read device_health').toBe(true)
  const rows = (await response.json()) as Record<string, unknown>[]
  return rows[0] ?? null
}

async function forgetHealth(request: APIRequestContext) {
  const response = await request.delete(`${SUPABASE_URL}/rest/v1/device_health`, {
    headers: serviceHeaders(),
    params: { device_id: `eq.${TILL_ONE_DEVICE}` },
  })
  expect(response.ok(), 'could not clear device_health').toBe(true)
}

test(
  'a counter running the probe shows PB in its build code',
  { tag: '@cg-on:probe' },
  async ({ browser, request }) => {
    const { context, page } = await openTill(browser, request, TILL_ONE)
    await expect(page.getByTestId('build-version')).toHaveAttribute(
      'data-build-code',
      /^[0-9a-f]+·(\w\w-)*PB(-\w\w)*$/,
    )
    await context.close()
  },
)

test(
  'a counter running tablet health reports its build, its gates and counts, and never a query',
  { tag: '@cg-on:tablet-health' },
  async ({ browser, request }) => {
    await forgetHealth(request)
    const { context, page } = await openTill(browser, request, TILL_ONE)
    const stamp = (await page.getByTestId('build-version').textContent()) ?? ''
    const build = /Build (\S+)/.exec(stamp)?.[1]

    // A page reports as soon as it boots, then every minute.
    await expect.poll(() => healthRow(request), { timeout: 20_000 }).not.toBeNull()
    const row = (await healthRow(request))!
    expect(row['build']).toBe(build)
    expect(row['booted_gates']).toEqual(expect.arrayContaining(['probe', 'tablet-health']))
    expect(row['window_seconds']).toBe(60)
    expect(row['requests']).toEqual(expect.any(Number))
    expect(row['requests'] as number).toBeGreaterThan(0)
    expect(row['failed']).toBe(0)
    // Counts and durations only: no URL, query, filter or body reached the row.
    expect(JSON.stringify(row)).not.toMatch(/\?|=|eq\.|rest\/v1|phone/)
    await context.close()
  },
)

test(
  'with tablet health off, a counter reports nothing',
  { tag: '@cg-off:tablet-health' },
  async ({ browser, request }) => {
    await forgetHealth(request)
    const { context, page } = await openTill(browser, request, TILL_ONE)
    // The report would leave the moment the counter's screen mounted; give it
    // the same twenty seconds the gates-on test allows, then look once.
    await page.waitForTimeout(20_000)
    expect(await healthRow(request)).toBeNull()
    await context.close()
  },
)
