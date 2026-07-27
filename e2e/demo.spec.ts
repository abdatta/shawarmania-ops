import { expect, test } from '@playwright/test'

// baseURL carries the deployment sub-path, so every goto here is relative.
// A leading slash would resolve against the origin and skip the base.
//
// The first test is the network-level half of the demo safety proof (design
// D4, layer 4): fail on ANY request that leaves the app's own origin while
// the demo is walked. Static assets are same-origin, so the allowance is
// simply "same origin"; everything else — Supabase or otherwise — is a
// violation.

const ROLE_SEGMENTS = ['owner', 'admin', 'biller', 'staff'] as const

test('walking all four demo role shells makes no request beyond the app origin', async ({
  page,
  baseURL,
}) => {
  const origin = new URL(baseURL ?? 'http://127.0.0.1:4173/').origin
  const violations: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== origin) violations.push(request.url())
  })

  await page.goto('demo/owner')
  await expect(page.getByTestId('demo-banner')).toBeVisible()
  await expect(page.getByText('Shawarmania Kalyani')).toBeVisible()

  // The switcher, through all four roles.
  const switcher = page.getByRole('navigation', { name: 'Demo role switcher' })
  await switcher.getByRole('link', { name: 'Admin' }).click()
  await expect(page.getByText('Outlet details')).toBeVisible()

  await switcher.getByRole('link', { name: 'Biller' }).click()
  await expect(page.getByTestId('shift-status')).toBeVisible()

  await switcher.getByRole('link', { name: 'Staff' }).click()
  await expect(page.getByText('Hello, Demo Staff')).toBeVisible()

  await switcher.getByRole('link', { name: 'Owner' }).click()
  await expect(page.getByText('All outlets')).toBeVisible()

  expect(violations).toEqual([])
})

test('the demo banner is on every demo route and offers no dismissal', async ({ page }) => {
  for (const segment of ROLE_SEGMENTS) {
    await page.goto(`demo/${segment}`)
    const banner = page.getByTestId('demo-banner')
    await expect(banner, segment).toBeVisible()
    await expect(banner, segment).toContainText('Demo — fabricated data')
    // No button of any kind inside the banner — the switcher is links only.
    await expect(banner.locator('button'), segment).toHaveCount(0)
  }
})

test('a demo deep link reconstructs the same role and surface on reload', async ({ page }) => {
  await page.goto('demo/admin')
  await expect(page.getByText('Outlet details')).toBeVisible()

  await page.reload()
  await expect(page.getByText('Outlet details')).toBeVisible()
  await expect(page.getByTestId('demo-banner')).toBeVisible()

  // And from a cold start with no prior navigation (fresh SPA boot via the
  // static-hosting fallback, same as a shared link).
  await page.goto('demo/staff')
  await expect(page.getByText('Hello, Demo Staff')).toBeVisible()
})

test('the demo index lands on the owner shell', async ({ page }) => {
  await page.goto('demo')
  await expect(page).toHaveURL(/\/demo\/owner$/)
  await expect(page.getByTestId('demo-banner')).toBeVisible()
})

test('a hidden surface is absent: its deep link lands on not-found inside the shell', async ({
  page,
}) => {
  await page.goto('demo/admin/inventory')
  await expect(page.getByText('That page does not exist')).toBeVisible()
  // Still a demo URL, so the banner still stands.
  await expect(page.getByTestId('demo-banner')).toBeVisible()
})

test('the landing page links into the demo', async ({ page }) => {
  await page.goto('.')
  await page.getByRole('link', { name: 'View the demo' }).click()
  await expect(page).toHaveURL(/\/demo\/owner$/)
  await expect(page.getByTestId('demo-banner')).toBeVisible()
})

test.describe('with a persisted real session', () => {
  /**
   * A far-future fake session written at the client's fixed storage key
   * (auth.storageKey in src/data-access/supabase.ts). Fake but shaped like
   * the real thing; the guard reads it through supabase-js's own
   * getSession(), which never needs the network for an unexpired session.
   */
  const FAKE_SESSION = {
    access_token: 'header.payload.signature',
    refresh_token: 'fake-refresh-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: 4102444800, // 2100-01-01
    user: {
      id: '10000000-0000-4000-a000-000000000001',
      aud: 'authenticated',
      role: 'authenticated',
      email: 'owner@example.com',
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: {},
      created_at: '2026-07-26T00:00:00Z',
    },
  }

  test.beforeEach(async ({ page }) => {
    // The storage write needs an origin, so land on the app first.
    await page.goto('.')
    await page.evaluate(
      ([key, session]) => localStorage.setItem(key as string, JSON.stringify(session)),
      ['shawarmania.auth', FAKE_SESSION] as const,
    )
  })

  test('demo entry interposes the interstitial, and continue is explicit', async ({ page }) => {
    await page.goto('demo/owner')

    const interstitial = page.getByTestId('demo-interstitial')
    await expect(interstitial).toBeVisible()
    await expect(page.getByTestId('demo-banner')).not.toBeVisible()

    await page.getByRole('button', { name: 'Continue to demo' }).click()
    await expect(page.getByTestId('demo-banner')).toBeVisible()
    await expect(page.getByText('All outlets')).toBeVisible()
  })

  test('the continue choice is tab-scoped: a fresh tab is gated again', async ({
    page,
    context,
  }) => {
    await page.goto('demo/owner')
    await page.getByRole('button', { name: 'Continue to demo' }).click()
    await expect(page.getByTestId('demo-banner')).toBeVisible()

    // Same profile (same localStorage session), new tab: sessionStorage does
    // not follow, so the interstitial must return.
    const fresh = await context.newPage()
    await fresh.goto(page.url())
    await expect(fresh.getByTestId('demo-interstitial')).toBeVisible()
    await fresh.close()
  })

  test('back to the app leaves demo without acknowledging', async ({ page }) => {
    await page.goto('demo/owner')
    await page.getByRole('link', { name: 'Back to the app' }).click()
    await expect(page.getByRole('link', { name: 'View the demo' })).toBeVisible()

    // Nothing was acknowledged, so demo entry gates again.
    await page.goto('demo/owner')
    await expect(page.getByTestId('demo-interstitial')).toBeVisible()
  })
})
