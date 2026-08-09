import { expect, test } from '@playwright/test'

import { E2E_ORIGIN } from '../ports'

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
  const origin = new URL(baseURL ?? E2E_ORIGIN).origin
  const violations: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== origin) violations.push(request.url())
  })

  await page.goto('demo/owner')
  await expect(page.getByTestId('demo-banner')).toBeVisible()
  // The card's own heading. The outlet switcher carries the same name as an
  // option, so a bare text match is ambiguous — and the assertion here is that
  // the outlet's figures rendered, not that its name appears somewhere.
  await expect(page.getByRole('heading', { name: 'Shawarmania Kalyani' })).toBeVisible()

  // The switcher, through all four roles.
  const switcher = page.getByRole('navigation', { name: 'Demo role switcher' })
  await switcher.getByRole('link', { name: 'Admin' }).click()
  await expect(page.getByText('Outlet details')).toBeVisible()

  await switcher.getByRole('link', { name: 'Biller' }).click()
  await expect(page.getByTestId('shift-status')).toBeVisible()

  await switcher.getByRole('link', { name: 'Staff' }).click()
  await expect(page.getByText('Hello, Demo Staff')).toBeVisible()

  await switcher.getByRole('link', { name: 'Owner' }).click()
  await expect(page.getByRole('heading', { name: 'All outlets' })).toBeVisible()

  // The new owner control is part of this same network-safety walk: opening
  // it must stay as permanently demo-only as the four shells around it.
  await page.goto('demo/owner/people')
  await page.getByRole('button', { name: 'Add person' }).click()
  await expect(page.getByTestId('account-outlet-options')).toBeVisible()
  await expect(page.getByRole('checkbox', { name: 'Shawarmania Kalyani' })).toBeVisible()
  await expect(page.getByRole('checkbox', { name: 'Shawarmania Kanchrapara' })).toBeVisible()

  expect(violations).toEqual([])
})

test('the demo banner is on every demo route and offers no dismissal', async ({ page }) => {
  for (const segment of ROLE_SEGMENTS) {
    await page.goto(`demo/${segment}`)
    const banner = page.getByTestId('demo-banner')
    await expect(banner, segment).toBeVisible()
    await expect(banner, segment).toContainText('Demo — fabricated data')

    // The invariant itself rather than a proxy for it: press every control in
    // the strip and the strip is still there. Counting buttons stood in for
    // this until the banner gained one — the reset — that does something other
    // than dismiss it.
    const controls = banner.locator('button')
    const count = await controls.count()
    for (let index = 0; index < count; index += 1) {
      await controls.nth(index).click()
      await expect(banner, segment).toBeVisible()
      const cancel = page.getByRole('button', { name: 'Cancel' })
      if (await cancel.isVisible()) await cancel.click()
    }
    await expect(banner, segment).toBeVisible()
  }
})

test('the demo can be left, and leaving is not dismissing', async ({ page }) => {
  await page.goto('demo/owner')
  await expect(page.getByTestId('demo-banner')).toBeVisible()

  // Somebody handed this link had no way out but the address bar. The exit is a
  // link to the root, so the indicator goes only once the fabricated data it is
  // warning about has gone with it.
  await page.getByTestId('demo-exit').click()

  await expect(page).not.toHaveURL(/\/demo/)
  await expect(page.getByTestId('demo-banner')).toHaveCount(0)

  // The exit still points at the root; what the root does with a visitor who has
  // no session changed. Since the-root-resolves-instead-of-greeting it resolves
  // onward to sign-in instead of rendering a card, so the way in is a form here
  // rather than a link (D1).
  await expect(page).toHaveURL(/\/sign-in$/)
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
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
  // `counter-my-shift` is `hidden`. `devices` used to be and went `live` with
  // counter-devices-and-offline; `pnl` used to be and is `demo` since
  // ui-owner-console-and-demo. The assertion is about a hidden surface, so it
  // follows the gate rather than the path — which is why it has now moved twice
  // without ever changing what it claims.
  await page.goto('demo/biller/my-shift')
  await expect(page.getByText('That page does not exist')).toBeVisible()
  // Still a demo URL, so the banner still stands.
  await expect(page.getByTestId('demo-banner')).toBeVisible()
})

test('the unauthenticated entry screen offers no route into the demo', async ({ page }) => {
  // The root no longer renders anything itself: it resolves, and with no session
  // that means sign-in (the-root-resolves-instead-of-greeting, D1). So the
  // absence has to hold on the screen the root actually reaches.
  await page.goto('.')
  await expect(page).toHaveURL(/\/sign-in$/)
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()

  // The demo stopped advertising itself when it became something the owner
  // distributes. The link lives in the Super Admin's account menu now; nothing
  // an unauthenticated visitor reaches should point at /demo
  // (ui-owner-console-and-demo, D9).
  await expect(page.getByRole('link', { name: /demo/i })).toHaveCount(0)
  expect(await page.locator('a[href*="/demo"]').count()).toBe(0)
})

test('the demo is still reachable without a session, by URL', async ({ page }) => {
  // Removing the link changed who *finds* the demo, not who may open it — a
  // shared link that demanded a login would not be a demo.
  await page.goto('demo/owner')
  await expect(page.getByTestId('demo-banner')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'All outlets' })).toBeVisible()
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
      email: 'owner@login.shawarmania.invalid',
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
    await expect(page.getByRole('heading', { name: 'All outlets' })).toBeVisible()
  })

  test('the link the owner hands out meets the interstitial too', async ({ page }) => {
    // `/demo` is exactly what the account menu copies. Following it while
    // signed in must land on the gate like any other demo URL — there is no
    // smoother path for the person who owns the menu it now sits in, because
    // an owner is no less capable of losing track of a tab than a biller is.
    await page.goto('demo')
    await expect(page.getByTestId('demo-interstitial')).toBeVisible()
    await expect(page.getByTestId('demo-banner')).not.toBeVisible()
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
    await expect(page).toHaveURL(/\/$/)

    // Nothing was acknowledged, so demo entry gates again.
    await page.goto('demo/owner')
    await expect(page.getByTestId('demo-interstitial')).toBeVisible()
  })
})
