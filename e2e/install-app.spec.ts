import { expect, test, type Page } from '@playwright/test'

const installName = 'Install Shawarmania Ops as an app'

async function offerInstallCapability(page: Page) {
  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt', { cancelable: true })
    Object.defineProperties(event, {
      prompt: {
        value: async () => {
          ;(
            window as Window & { __shawarmaniaInstallPromptCalls?: number }
          ).__shawarmaniaInstallPromptCalls =
            ((window as Window & { __shawarmaniaInstallPromptCalls?: number })
              .__shawarmaniaInstallPromptCalls ?? 0) + 1
        },
      },
      userChoice: {
        value: Promise.resolve({ outcome: 'accepted', platform: 'web' }),
      },
    })
    window.dispatchEvent(event)
  })
}

test('a captured install capability survives public navigation and is consumed once', async ({
  page,
  baseURL,
}, testInfo) => {
  const consoleErrors: string[] = []
  const unexpectedRequests: string[] = []
  const appOrigin = new URL(baseURL!).origin
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== appOrigin) {
      unexpectedRequests.push(request.url())
    }
  })

  await page.goto('.')
  await page.evaluate(() => {
    localStorage.setItem('shawarmania.theme', 'light')
  })
  await page.reload()
  await offerInstallCapability(page)

  const install = page.getByRole('button', { name: installName })
  await expect(install).toBeVisible()

  const capture = async (viewport: 'phone' | 'tablet', theme: 'light' | 'dark') => {
    await page.setViewportSize(
      viewport === 'phone' ? { width: 390, height: 844 } : { width: 1080, height: 810 },
    )
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    const target = await install.boundingBox()
    expect(target?.height).toBeGreaterThanOrEqual(44)
    expect(
      await page.locator('header').evaluate((header) => header.scrollWidth <= header.clientWidth),
    ).toBe(true)
    await testInfo.attach(`public-${theme}-${viewport}`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
  }

  await capture('phone', 'light')
  await page.getByRole('button', { name: 'Switch to dark theme' }).click()
  await capture('phone', 'dark')
  await capture('tablet', 'dark')
  await page.getByRole('button', { name: 'Switch to light theme' }).click()
  await capture('tablet', 'light')

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(install.getByText('Install')).toHaveCSS('opacity', '1')
  await testInfo.attach('public-reduced-motion-phone', {
    body: await page.screenshot(),
    contentType: 'image/png',
  })

  // The public tree used to have two screens and a link between them: a landing
  // card and the sign-in it pointed at. Since
  // the-root-resolves-instead-of-greeting the root renders nothing and resolves
  // straight here, so `.` above already IS sign-in and there is no second public
  // screen to hop to. Activation cannot stand in for one: this test forbids
  // off-origin requests, and previewing a code would call the (dummy) Supabase
  // host configured in playwright.config.ts.
  //
  // Nothing is lost. Survival across a navigation is covered where it matters
  // more — `e2e-auth/auth.spec.ts` captures the capability on this screen, signs
  // in for real, and asserts the action is still there once the role shell has
  // mounted. That crosses a session boundary, which this hop never did.
  await expect(page).toHaveURL(/\/sign-in$/)
  await expect(install).toBeVisible()

  await install.click()
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { __shawarmaniaInstallPromptCalls?: number })
            .__shawarmaniaInstallPromptCalls ?? 0,
      ),
    )
    .toBe(1)
  await expect(install).toHaveCount(0)
  expect(consoleErrors).toEqual([])
  expect(unexpectedRequests).toEqual([])
})

test('installed display mode suppresses the app-owned action', async ({ page }) => {
  await page.addInitScript(() => {
    window.matchMedia = (query: string) =>
      ({
        matches: query === '(display-mode: standalone)',
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }) as MediaQueryList
  })
  await page.goto('.')
  await offerInstallCapability(page)

  await expect(page.getByRole('button', { name: installName })).toHaveCount(0)
})

test('demo mode does not promote installing fabricated data', async ({ page }) => {
  await page.goto('demo/owner')
  await expect(page.getByTestId('demo-banner')).toBeVisible()
  await offerInstallCapability(page)

  await expect(page.getByRole('button', { name: installName })).toHaveCount(0)
})

test('iOS Safari receives the manual Add to Home Screen path', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    Object.defineProperties(navigator, {
      userAgent: {
        configurable: true,
        get: () =>
          'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
      },
      platform: {
        configurable: true,
        get: () => 'iPhone',
      },
      maxTouchPoints: {
        configurable: true,
        get: () => 5,
      },
    })
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('.')

  const install = page.getByRole('button', { name: installName })
  await install.click()
  await expect(
    page.getByText(
      'In Safari, tap Share, then Add to Home Screen. Turn on Open as Web App, then tap Add.',
    ),
  ).toBeVisible()
  await testInfo.attach('ios-safari-install-instructions', {
    body: await page.screenshot(),
    contentType: 'image/png',
  })
})
