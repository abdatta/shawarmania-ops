import { expect, test, type Page } from '@playwright/test'

/**
 * The offline gate, automated.
 *
 * The network is genuinely disabled rather than mocked away — a service worker
 * that "should" precache the shell but does not is exactly the failure this
 * has to catch, and a mocked fetch would hide it.
 *
 * The manual half of this gate (installing on a real Android phone) stays a
 * human step; a headless browser cannot prove the install flow works.
 */

/**
 * Get the app into the state a real device is in on its second launch: worker
 * installed, precache populated, page controlled.
 *
 * Two loads are required because `clientsClaim` is deliberately off. A worker
 * that claims already-open pages would, on an update, start serving new-build
 * assets to old-build code mid-shift — the version skew we accept one extra
 * launch to avoid. It costs nothing in practice: the shell is precached during
 * the first load, so the app is offline-capable from the next launch onward,
 * and installing a PWA involves opening it more than once anyway.
 */
async function primeServiceWorker(page: Page) {
  await page.goto('.')

  // `ready` resolves once a worker is active, which implies precaching finished
  // — it runs inside install's waitUntil. Awaited through evaluate rather than
  // waitForFunction: the latter treats a returned Promise as a truthy result
  // and resolves immediately, letting the reload below race the activation.
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined))

  await page.reload()
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, {
    timeout: 30_000,
  })
}

test.describe('offline app shell', () => {
  // Serial: the shell must be cached by an online load before going offline,
  // which is the real-world sequence too.
  test.describe.configure({ mode: 'serial' })

  test('the shell renders with the network off', async ({ page, context }) => {
    await primeServiceWorker(page)

    await context.setOffline(true)
    await page.reload()

    await expect(page.getByRole('banner').getByText('Shawarmania Ops')).toBeVisible()
    await expect(page.getByTestId('build-version')).toBeVisible()

    await context.setOffline(false)
  })

  test('the brand font is precached, not fetched at render time', async ({ page, context }) => {
    await primeServiceWorker(page)

    await context.setOffline(true)
    await page.reload()

    // A font served from the network would silently fall back to a system face.
    await expect
      .poll(() => page.evaluate(() => document.fonts.check('1rem "Nunito Sans Variable"')))
      .toBe(true)

    await context.setOffline(false)
  })

  test('a deep link still resolves offline via the navigation fallback', async ({
    page,
    context,
  }) => {
    await primeServiceWorker(page)

    await context.setOffline(true)
    await page.goto('nope/not/a/route')

    await expect(page.getByText('That page does not exist')).toBeVisible()

    await context.setOffline(false)
  })
})
