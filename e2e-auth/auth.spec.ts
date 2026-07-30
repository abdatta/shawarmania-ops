import { expect, test, type Browser, type Page } from '@playwright/test'

const PASSWORD = 'shawarmania-local'
const NEW_PASSWORD = 'a-genuinely-set-password'
const RESET_PASSWORD = 'a-second-genuine-password'

const PERSONAS = {
  owner: {
    username: 'owner',
    segment: 'owner',
    lands: (page: Page) => page.getByRole('heading', { name: 'All outlets' }),
  },
  admin: {
    username: 'admin.kalyani',
    segment: 'admin',
    lands: (page: Page) => page.getByText('Outlet details'),
  },
  biller: {
    username: 'biller.kalyani',
    segment: 'biller',
    lands: (page: Page) => page.getByText('No shift open'),
  },
  staff: {
    username: 'staff.kalyani',
    segment: 'staff',
    lands: (page: Page) => page.getByText('Hello, Synthetic Staff'),
  },
} as const

const RUN = Date.now().toString(36).slice(-8)
let sequence = 0

interface FreshPerson {
  name: string
  username: string
}

function freshPerson(label: string): FreshPerson {
  const id = sequence++
  return {
    name: `E2E ${label} ${RUN}-${id}`,
    username: `e2e.${label}.${RUN}.${id}`,
  }
}

async function attemptSignIn(page: Page, username: string, password: string) {
  await page.goto('sign-in')
  await page.getByLabel('Username or email', { exact: true }).fill(username)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

async function signIn(page: Page, username: string, password = PASSWORD) {
  await attemptSignIn(page, username, password)
  await expect(page).not.toHaveURL(/\/sign-in$/)
}

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

async function signOut(page: Page) {
  await page.getByTestId('account-menu').click()
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/sign-in$/)
}

async function activate(browser: Browser, link: string, username: string, password = NEW_PASSWORD) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(link)

  await expect(page.getByTestId('activate-username')).toHaveText(username)
  await expect(page.getByLabel('One-time code')).toHaveCount(0)
  const usernameField = page.getByLabel('Username', { exact: true })
  const passwordField = page.getByLabel('New password')
  const repeatField = page.getByLabel('Re-type password')
  await expect(usernameField).toHaveAttribute('name', 'username')
  await expect(usernameField).toHaveAttribute('autocomplete', 'username')
  await expect(passwordField).toHaveAttribute('autocomplete', 'new-password')
  await expect(repeatField).toHaveAttribute('autocomplete', 'new-password')

  await usernameField.fill(username)
  await passwordField.fill(password)
  await repeatField.fill(password)
  await page.getByRole('button', { name: 'Set password and sign in' }).click()
  await expect(page).not.toHaveURL(/\/activate/)
  return { context, page }
}

async function provisionEmployee(
  page: Page,
  person: FreshPerson,
  outlets: string[] = ['Shawarmania Kalyani'],
) {
  await page.getByRole('button', { name: 'Add person' }).click()
  await page.getByLabel('Full name').fill(person.name)
  await page.getByLabel('Username', { exact: true }).fill(person.username)
  for (const outlet of outlets) {
    await page.getByRole('checkbox', { name: outlet }).check()
  }
  await page.getByRole('button', { name: 'Create and issue a code' }).click()

  const panel = page.getByTestId('issued-code')
  await expect(panel).toBeVisible()
  await expect(panel.getByTestId('issued-code-username')).toContainText(person.username)
  const link = (await panel.getByTestId('issued-code-link').innerText()).trim()
  expect(new URL(link).searchParams.get('code')).toMatch(
    /^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/,
  )
  expect(link).not.toContain(person.username)
  return { link, panel }
}

test.describe('username sign-in and role routing', () => {
  for (const [label, persona] of Object.entries(PERSONAS)) {
    test(`a ${label} signs in and lands on their own shell`, async ({ page }) => {
      await signIn(page, persona.username)

      await expect(page).toHaveURL(new RegExp(`/${persona.segment}$`))
      await expect(persona.lands(page)).toBeVisible()
      await expect(page.getByTestId('account-menu')).toBeVisible()
      await expect(page.getByTestId('demo-banner')).toHaveCount(0)
    })
  }

  for (const label of ['owner', 'biller'] as const) {
    const persona = PERSONAS[label]

    test(`the install action follows a ${label} from public chrome into their shell`, async ({
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
        const origin = new URL(request.url()).origin
        if (origin !== appOrigin && origin !== 'http://127.0.0.1:54321') {
          unexpectedRequests.push(request.url())
        }
      })

      await page.goto('sign-in')
      await page.evaluate(() => {
        localStorage.setItem('shawarmania.theme', 'light')
      })
      await page.reload()
      await offerInstallCapability(page)
      await expect(
        page.getByRole('button', {
          name: 'Install Shawarmania Ops as an app',
        }),
      ).toBeVisible()

      await page.getByLabel('Username or email', { exact: true }).fill(persona.username)
      await page.getByLabel('Password').fill(PASSWORD)
      await page.getByRole('button', { name: 'Sign in' }).click()

      await expect(page).toHaveURL(new RegExp(`/${persona.segment}$`))
      const install = page.getByRole('button', {
        name: 'Install Shawarmania Ops as an app',
      })
      await expect(install).toBeVisible()

      const capture = async (viewport: 'phone' | 'tablet', theme: 'light' | 'dark') => {
        const size =
          viewport === 'phone' ? { width: 390, height: 844 } : { width: 1080, height: 810 }
        await page.setViewportSize(size)
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
        await expect(install).toBeVisible()
        const target = await install.boundingBox()
        expect(target?.height).toBeGreaterThanOrEqual(44)
        expect(
          await page
            .getByRole('banner')
            .evaluate((header) => header.scrollWidth <= header.clientWidth),
        ).toBe(true)
        await testInfo.attach(`${label}-${theme}-${viewport}`, {
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
      await testInfo.attach(`${label}-reduced-motion-phone`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      })

      await install.click()
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (
                window as Window & {
                  __shawarmaniaInstallPromptCalls?: number
                }
              ).__shawarmaniaInstallPromptCalls ?? 0,
          ),
        )
        .toBe(1)
      await expect(install).toHaveCount(0)
      expect(consoleErrors).toEqual([])
      expect(unexpectedRequests).toEqual([])
    })
  }

  test('unknown username and wrong password remain indistinguishable', async ({ page }) => {
    await attemptSignIn(page, PERSONAS.owner.username, 'not-the-password')
    await expect(page.getByTestId('signin-error')).toHaveText(
      'Those sign-in details are not right.',
    )

    await attemptSignIn(page, 'nobody.at.all', 'not-the-password')
    await expect(page.getByTestId('signin-error')).toHaveText(
      'Those sign-in details are not right.',
    )
    await expect(page).toHaveURL(/\/sign-in$/)
  })

  test('an associated email signs in to the same account as its username', async ({ page }) => {
    await signIn(page, 'owner.account@example.com')
    await expect(page).toHaveURL(/\/owner$/)
    await expect(PERSONAS.owner.lands(page)).toBeVisible()
    await signOut(page)
  })

  test('a deep link survives username sign-in', async ({ page }) => {
    await page.goto('admin/people')
    await expect(page).toHaveURL(/\/sign-in$/)

    await page.getByLabel('Username or email', { exact: true }).fill(PERSONAS.admin.username)
    await page.getByLabel('Password').fill(PASSWORD)
    await expect(page.getByLabel('Password')).toHaveAttribute('autocomplete', 'current-password')
    await page.getByRole('button', { name: 'Sign in' }).click()

    await expect(page).toHaveURL(/\/admin\/people$/)
    await expect(page.getByRole('heading', { name: 'People' })).toBeVisible()
  })

  test('another role path redirects to the live assignment shell', async ({ page }) => {
    await signIn(page, PERSONAS.staff.username)
    await page.goto('owner')
    await expect(page).toHaveURL(/\/staff$/)
    await expect(PERSONAS.staff.lands(page)).toBeVisible()

    await page.reload()
    await expect(PERSONAS.staff.lands(page)).toBeVisible()
    await signOut(page)
  })
})

test.describe('provisioning and admin-issued reset', () => {
  test('one username-only hire activates at two outlets', async ({ page, browser }) => {
    const person = freshPerson('starter')
    await signIn(page, PERSONAS.owner.username)
    await page.goto('owner/people')

    const { link, panel } = await provisionEmployee(page, person, [
      'Shawarmania Kalyani',
      'Shawarmania Kanchrapara',
    ])
    const row = page.getByRole('row', { name: new RegExp(person.name) })
    await expect(row).toContainText('Awaiting activation')
    await expect(row).toContainText('Shawarmania Kalyani')
    await expect(row).toContainText('Shawarmania Kanchrapara')
    await expect(panel.getByRole('img', { name: new RegExp(person.name) })).toBeVisible()

    const activated = await activate(browser, link, person.username)
    await expect(activated.page).toHaveURL(/\/staff$/)
    await expect(activated.page.getByText(`Hello, ${person.name}`)).toBeVisible()
    await expect(activated.page.getByTestId('attendance-action')).toBeVisible()

    const replayContext = await browser.newContext()
    const replay = await replayContext.newPage()
    await replay.goto(link)
    await expect(replay.getByTestId('activate-error')).toContainText('no longer usable')
    await expect(replay.getByLabel('New password')).toHaveCount(0)

    await activated.context.close()
    await replayContext.close()
  })

  test('rename preserves a session and an admin-issued reset changes the password', async ({
    page,
    browser,
  }) => {
    const person = freshPerson('rename')
    const renamed = `${person.username}.new`
    await signIn(page, PERSONAS.owner.username)
    await page.goto('owner/people')
    const issued = await provisionEmployee(page, person)
    const activated = await activate(browser, issued.link, person.username)
    await expect(activated.page).toHaveURL(/\/staff$/)

    await issued.panel.getByRole('button', { name: 'Done' }).click()
    let row = page.getByRole('row', { name: new RegExp(person.name) })
    await row.getByRole('button', { name: /^Actions for / }).click()
    await row.getByRole('button', { name: 'Change username' }).click()
    const renameSheet = page.getByRole('dialog')
    await renameSheet.getByLabel('Username', { exact: true }).fill(renamed)
    await renameSheet.getByRole('button', { name: 'Save username' }).click()
    await expect(page.getByText(renamed, { exact: true })).toBeVisible()

    await activated.page.reload()
    await expect(activated.page).toHaveURL(/\/staff$/)
    await expect(activated.page.getByText(`Hello, ${person.name}`)).toBeVisible()

    const oldContext = await browser.newContext()
    const oldLogin = await oldContext.newPage()
    await attemptSignIn(oldLogin, person.username, NEW_PASSWORD)
    await expect(oldLogin.getByTestId('signin-error')).toHaveText(
      'Those sign-in details are not right.',
    )

    const renamedContext = await browser.newContext()
    const renamedLogin = await renamedContext.newPage()
    await signIn(renamedLogin, renamed, NEW_PASSWORD)
    await expect(renamedLogin).toHaveURL(/\/staff$/)

    row = page.getByRole('row', { name: new RegExp(person.name) })
    await row.getByRole('button', { name: /^Actions for / }).click()
    await row.getByRole('button', { name: 'New code' }).click()
    const resetPanel = page.getByTestId('issued-code')
    const resetLink = (await resetPanel.getByTestId('issued-code-link').innerText()).trim()
    const reset = await activate(browser, resetLink, renamed, RESET_PASSWORD)
    await expect(reset.page).toHaveURL(/\/staff$/)

    const resetLoginContext = await browser.newContext()
    const resetLogin = await resetLoginContext.newPage()
    await signIn(resetLogin, renamed, RESET_PASSWORD)
    await expect(resetLogin).toHaveURL(/\/staff$/)

    await activated.context.close()
    await oldContext.close()
    await renamedContext.close()
    await reset.context.close()
    await resetLoginContext.close()
  })
})

test('deactivation ends an open username session immediately', async ({ page, browser }) => {
  const person = freshPerson('doomed')
  await signIn(page, PERSONAS.owner.username)
  await page.goto('owner/people')
  const issued = await provisionEmployee(page, person)
  const activated = await activate(browser, issued.link, person.username)
  await expect(activated.page).toHaveURL(/\/staff$/)

  await issued.panel.getByRole('button', { name: 'Done' }).click()
  const row = page.getByRole('row', { name: new RegExp(person.name) })
  await row.getByRole('button', { name: /^Actions for / }).click()
  await row.getByRole('button', { name: 'Deactivate' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('immediately')
  await dialog.getByRole('button', { name: 'Deactivate' }).click()
  await expect(row).toContainText('Deactivated')

  await activated.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect(activated.page).toHaveURL(/\/sign-in$/)
  await expect(activated.page.getByTestId('session-ended')).toContainText(
    'Your account has been deactivated',
  )
  await activated.context.close()
})

test('demo mode remains isolated beside a real username session', async ({ page }) => {
  await signIn(page, PERSONAS.owner.username)
  await page.goto('demo/owner')
  await expect(page.getByTestId('demo-interstitial')).toBeVisible()

  await page.getByRole('button', { name: 'Continue to demo' }).click()
  await expect(page.getByTestId('demo-banner')).toBeVisible()
  await expect(page.getByTestId('account-menu')).toHaveCount(0)
  await page.goto('demo/owner/people')
  await expect(page.getByText('Demo Manager', { exact: true })).toBeVisible()
  await expect(page.getByTestId('demo-banner')).toBeVisible()
})
