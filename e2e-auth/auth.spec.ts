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
    // The outlets overview, scoped by `outlets_select` to their own outlet.
    lands: (page: Page) => page.getByRole('heading', { level: 1, name: 'Shawarmania Kalyani' }),
  },
  biller: {
    username: 'biller.kalyani',
    segment: 'staff',
    // A personal Biller login is a staff phone, never a second till. Billing is
    // mounted only by the enrolled device principal under /counter.
    lands: (page: Page) => page.getByText('Hello, Synthetic Biller'),
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

test('an owner builds a sellable menu for a new outlet entirely through the app', async ({
  page,
}) => {
  const outletName = `E2E Menu Outlet ${RUN}`
  const outletCode = `menu-${RUN}`
  await signIn(page, PERSONAS.owner.username)

  await page.goto('owner/outlets')
  await page.getByTestId('add-outlet').click()
  await page.getByLabel('Name', { exact: true }).fill(outletName)
  await page.getByLabel('Short code').fill(outletCode)
  await page.getByLabel('Location label').fill('E2E menu test')
  await page.getByRole('button', { name: 'Create outlet' }).click()
  await expect(page.getByText(outletName, { exact: true })).toBeVisible()

  await page.goto('owner/menu')
  const outletChip = page.getByRole('group', { name: 'Outlet' }).getByRole('button', {
    name: outletName,
  })
  if ((await outletChip.getAttribute('aria-pressed')) !== 'true') {
    await outletChip.click()
  }
  await expect(outletChip).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText(/Nothing on the menu yet/)).toBeVisible()

  await page.getByTestId('add-menu-item').click()
  await page.getByLabel('Name', { exact: true }).fill('E2E Chicken Roll')
  await page.getByRole('combobox', { name: 'Category' }).fill('Rolls')
  await page.getByLabel('Price (₹)').fill('125')
  // The outlet is empty, so nothing resembles "Rolls" and nothing is asked.
  await page.getByRole('button', { name: 'Create item' }).click()

  await expect(page.getByRole('heading', { name: 'Rolls' })).toBeVisible()
  await expect(page.getByText('E2E Chicken Roll')).toBeVisible()
  await expect(page.getByText('₹125')).toBeVisible()

  // A second item under a near miss of that category: the existing spelling is
  // offered, picking it commits nothing until it is confirmed, and the item
  // lands under the heading that already exists rather than beside it.
  await page.getByTestId('add-menu-item').click()
  await page.getByLabel('Name', { exact: true }).fill('E2E Paneer Roll')
  await page.getByRole('combobox', { name: 'Category' }).fill('Rols')
  await page.getByLabel('Price (₹)').fill('135')
  await page.getByRole('button', { name: 'Create item' }).click()

  await expect(page.getByTestId('category-match-list')).toBeVisible()
  await expect(page.getByTestId('confirm-category-choice')).toBeDisabled()
  await page.getByTestId('use-category-Rolls').check()
  await page.getByRole('button', { name: 'Use “Rolls”' }).click()

  await expect(page.getByText('E2E Paneer Roll')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Rolls', exact: true })).toHaveCount(1)
  await expect(page.getByRole('heading', { name: 'Rols' })).toHaveCount(0)
})

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

  const panel = page.getByTestId('account-handover')
  await expect(panel).toBeVisible()
  await expect(panel.getByTestId('account-handover-username')).toContainText(person.username)
  const link = (await panel.getByTestId('account-handover-link').innerText()).trim()
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
      if (label === 'biller') {
        await expect(
          page.getByRole('navigation').getByRole('link', { name: 'My attendance' }),
        ).toBeVisible()
        await expect(page.getByRole('link', { name: 'Counter' })).toHaveCount(0)
      }
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

  /**
   * The owner's reach, against a real backend (owner-reaches-every-outlet).
   *
   * The seeded owner holds `super_admin` and no outlet assignment, which is the
   * shape this change made ordinary — so this is the one place the claim is made
   * against real policies rather than against a mock.
   */
  test('the owner reaches an outlet-level surface with no assignment', async ({ page }) => {
    await signIn(page, PERSONAS.owner.username)
    await expect(PERSONAS.owner.lands(page)).toBeVisible()

    // Their own navigation carries it, addressed inside their own shell.
    const attendance = page
      .getByRole('navigation', { name: 'Primary' })
      .first()
      .getByRole('link', { name: /Attendance/ })
    await expect(attendance).toHaveAttribute('href', /\/owner\/attendance$/)
    await attendance.click()
    await expect(page).toHaveURL(/\/owner\/attendance$/)
    await expect(page.getByRole('heading', { name: 'Attendance' })).toBeVisible()

    // One home, not two: `admin-dashboard` belongs to a role they do not hold.
    // Both homes carry the label `Overview` since #51, so the claim is that
    // exactly one entry carries it rather than that a second word is absent.
    await expect(
      page
        .getByRole('navigation', { name: 'Primary' })
        .first()
        .getByRole('link', { name: /^Overview/ }),
    ).toHaveCount(1)

    // The manager's own address still renders for them rather than redirecting,
    // because they can reach that role's surfaces.
    await page.goto('admin/attendance')
    await expect(page).toHaveURL(/\/admin\/attendance$/)
    await expect(page.getByRole('heading', { name: 'Attendance' })).toBeVisible()
    await signOut(page)
  })

  /**
   * The remembered outlet, and the end of it (owner-reaches-every-outlet,
   * design D6). The store itself is unit-tested; what is walked here is the part
   * that only exists in a real session — signing out forgets it, because these
   * are phones that get handed over.
   */
  test('the outlet in scope is remembered, and a sign-out forgets it', async ({ page }) => {
    await signIn(page, PERSONAS.owner.username)
    await page.goto('owner/attendance')

    // Attendance takes several outlets at once since
    // attendance-one-day-per-person, so its selector is a toggle per outlet
    // rather than a dropdown. What is remembered is the whole selection.
    const picker = page.getByTestId('surface-outlets')
    await expect(picker).toBeVisible()
    const toggles = picker.getByRole('button')
    const ids = await toggles.evaluateAll((nodes) =>
      nodes.map((node) => ({
        id: node.getAttribute('data-testid') ?? '',
        on: node.getAttribute('aria-pressed') === 'true',
      })),
    )
    const opened = ids.find((entry) => entry.on)?.id
    const other = ids.find((entry) => !entry.on)?.id
    expect(other, 'the owner sees more than one outlet to choose between').toBeTruthy()

    // Add the other, drop the first: the last selected outlet cannot be cleared,
    // so switching is two presses in that order.
    await page.getByTestId(other!).click()
    await page.getByTestId(opened!).click()

    // It survives a reload. Carrying across *surfaces* is covered by the unit
    // tests, which can render two of them: in real mode the other outlet-scoped
    // surfaces are still demo-gated, so there is only one to walk here.
    await page.reload()
    await expect(page.getByTestId(other!)).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId(opened!)).toHaveAttribute('aria-pressed', 'false')

    await signOut(page)
    await signIn(page, PERSONAS.owner.username)
    await page.goto('owner/attendance')
    await expect(page.getByTestId(opened!)).toHaveAttribute('aria-pressed', 'true')
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
    await expect(row).toContainText('Set-up link issued')
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
    await row.getByRole('button', { name: 'Reset password' }).click()
    const resetPanel = page.getByTestId('account-handover')
    const resetLink = (await resetPanel.getByTestId('account-handover-link').innerText()).trim()
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

  test('an owner safely promotes, expands, and marks a person as left', async ({
    page,
    context,
  }) => {
    const person = freshPerson('transition')
    await signIn(page, PERSONAS.owner.username)
    await page.goto('owner/people')
    const issued = await provisionEmployee(page, person)
    await issued.panel.getByRole('button', { name: 'Done' }).click()

    let row = page.getByRole('row', { name: new RegExp(person.name) })
    await row.getByRole('button', { name: /^Actions for / }).click()
    await row.getByRole('button', { name: 'Edit' }).click()
    let editor = page.getByRole('dialog', { name: new RegExp(`Edit ${person.name}`) })
    await editor.getByLabel('Access role').selectOption('biller')

    await context.setOffline(true)
    await editor.getByRole('button', { name: 'Save' }).click()
    await expect(editor.getByTestId('form-sheet-error')).toBeVisible()
    await expect(page).toHaveURL(/\/owner\/people$/)
    await context.setOffline(false)

    await editor.getByRole('button', { name: 'Save' }).click()
    await expect(editor).toHaveCount(0)
    row = page.getByRole('row', { name: new RegExp(person.name) })
    await expect(row).toContainText('Biller')
    await expect(row).toContainText('Set-up link issued')

    await row.getByRole('button', { name: /^Actions for / }).click()
    await row.getByRole('button', { name: 'Edit' }).click()
    editor = page.getByRole('dialog', { name: new RegExp(`Edit ${person.name}`) })
    await editor.getByRole('button', { name: 'Works at multiple outlets' }).click()
    await editor.getByRole('button', { name: 'Add outlet' }).click()
    await editor
      .getByLabel('Outlet 2', { exact: true })
      .selectOption({ label: 'Shawarmania Kanchrapara' })
    await editor.getByRole('button', { name: 'Save' }).click()
    await expect(editor).toHaveCount(0)
    row = page.getByRole('row', { name: new RegExp(person.name) })
    await expect(row).toContainText('Shawarmania Kalyani')
    await expect(row).toContainText('Shawarmania Kanchrapara')

    await row.getByRole('button', { name: /^Actions for / }).click()
    await row.getByRole('button', { name: 'Edit' }).click()
    editor = page.getByRole('dialog', { name: new RegExp(`Edit ${person.name}`) })
    await editor.getByRole('button', { name: 'Mark as left' }).click()
    const confirmation = page.getByRole('dialog', { name: 'Mark this person as left?' })
    await expect(confirmation).toContainText('every current outlet assignment')
    await confirmation.getByRole('button', { name: 'Mark as left' }).click()
    await expect(page.getByRole('row', { name: new RegExp(person.name) })).toHaveCount(0)
  })

  test('owner access is granted and removed only through the guarded editor flow', async ({
    page,
  }) => {
    const person = freshPerson('ownerguard')
    await signIn(page, PERSONAS.owner.username)
    await page.goto('owner/people')
    const issued = await provisionEmployee(page, person)
    await issued.panel.getByRole('button', { name: 'Done' }).click()

    let row = page.getByRole('row', { name: new RegExp(person.name) })
    await row.getByRole('button', { name: /^Actions for / }).click()
    await row.getByRole('button', { name: 'Edit' }).click()
    let editor = page.getByRole('dialog', { name: new RegExp(`Edit ${person.name}`) })
    await editor.getByRole('button', { name: 'Grant owner access' }).click()
    await editor.getByLabel('Private sign-in email').fill(`${person.username}@example.com`)
    await editor.getByLabel('I understand this grants owner access across all outlets.').check()
    await editor.getByRole('button', { name: 'Save' }).click()
    await expect(editor).toHaveCount(0)
    row = page.getByRole('row', { name: new RegExp(person.name) })
    await expect(row).toContainText('All outlets')
    await expect(row).toContainText('Owner')

    await row.getByRole('button', { name: /^Actions for / }).click()
    await row.getByRole('button', { name: 'Edit' }).click()
    editor = page.getByRole('dialog', { name: new RegExp(`Edit ${person.name}`) })
    await editor.getByRole('button', { name: 'Remove owner access' }).click()
    await editor.getByRole('button', { name: 'Save' }).click()
    await expect(editor).toHaveCount(0)
    row = page.getByRole('row', { name: new RegExp(person.name) })
    await expect(row).not.toContainText('All outlets')
    await expect(row).toContainText('Shawarmania Kalyani')
  })
})

/**
 * The production failure, walked end to end: a real session, a real database,
 * and a phone that cannot produce a position.
 *
 * Every layer of the suite had this green while it was broken. The component
 * tests drove the mock adapter, which takes a null reading happily; the REST
 * suite always sent coordinates; and the demo walk never reaches Supabase. So a
 * two-outlet employee whose phone found nothing chose their shop, was told "that
 * did not work, try again in a moment", and had nothing recorded — for as long
 * as the path existed. This is the one place where the screen, the adapter and
 * the database are all real at once.
 *
 * A freshly provisioned hire on purpose: they hold no attendance row, so this
 * cannot collide with the suites that share the stack in CI, and a person holds
 * one row a business date.
 */
test('a two-outlet hire whose phone finds no position records the day and waits', async ({
  page,
  browser,
}) => {
  const person = freshPerson('unlocated')
  await signIn(page, PERSONAS.owner.username)
  await page.goto('owner/people')
  const issued = await provisionEmployee(page, person, [
    'Shawarmania Kalyani',
    'Shawarmania Kanchrapara',
  ])
  const activated = await activate(browser, issued.link, person.username)
  await expect(activated.page).toHaveURL(/\/staff$/)

  // Geolocation permission is never granted to this context, so the browser
  // refuses the read exactly as a phone with location off does.
  await activated.page.getByTestId('attendance-action').click()

  // Two live assignments and no reading, so the one question anybody is ever
  // asked, and nothing recorded until it is answered.
  const question = activated.page.getByTestId('attendance-which-outlet')
  await expect(question).toBeVisible()
  await expect(question).toHaveAttribute('data-failure', 'denied')
  await expect(question).toContainText('Location permission is off')

  await question.getByRole('button', { name: 'Shawarmania Kalyani' }).click()

  // Recorded, and honest about what it is worth: a claim waiting for a manager.
  // This assertion is the bug. It used to be the error message instead.
  await expect(activated.page.getByTestId('attendance-waiting')).toContainText(
    'waiting for your manager to approve it',
  )
  await expect(activated.page.getByTestId('attendance-error')).toHaveCount(0)

  // It survives a reload, because it is a row rather than a screen state.
  await activated.page.reload()
  await expect(activated.page.getByTestId('attendance-waiting')).toBeVisible()

  // And their manager settles it from a phone that cannot find a position
  // either — the other half of the same fault. No reading means this is treated
  // as an off-site approval, so it costs a written reason.
  const managerContext = await browser.newContext()
  const manager = await managerContext.newPage()
  await signIn(manager, PERSONAS.admin.username)
  await manager.goto('admin/attendance')

  const card = manager.locator('[data-testid^="day-"]').filter({ hasText: person.name })
  await expect(card).toBeVisible()
  // Exact, because the card's own expand control says "approve" in its label.
  await card.getByRole('button', { name: 'Approve', exact: true }).click()

  // The reason is demanded because nothing vouches for either of them: no
  // employee position, and no manager position to compare it against.
  await expect(manager.getByTestId('reason-required')).toBeVisible()
  await manager
    .getByLabel('Why are you approving this?')
    .fill('Both phones lost GPS; seen at the counter all morning')
  await manager.getByRole('button', { name: 'Approve and record my reason' }).click()

  await expect(manager.getByTestId('attendance-error')).toHaveCount(0)
  await expect(card).toContainText('Present')

  // The person reads their own settled day, reason and all.
  await activated.page.reload()
  await expect(activated.page.getByTestId('attendance-approved')).toBeVisible()

  await managerContext.close()
  await activated.context.close()
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
