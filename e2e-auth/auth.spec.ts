import { expect, test, type Page } from '@playwright/test'

/**
 * The roadmap gate for auth-and-roles, walked in a browser against the real
 * local stack: four roles sign in and land on their own shell, an admin
 * provisions an account end to end with a one-time code, and deactivating an
 * account blocks access without waiting for a token to expire.
 *
 * Needs the stack up — see playwright.auth.config.ts.
 *
 * baseURL carries the deployment sub-path, so every goto is relative.
 */

const PASSWORD = 'shawarmania-local'
const NEW_PASSWORD = 'a-genuinely-set-password'

const PERSONAS = {
  owner: { email: 'owner@example.com', segment: 'owner', lands: 'All outlets' },
  admin: { email: 'admin.kalyani@example.com', segment: 'admin', lands: 'Outlet details' },
  biller: { email: 'biller.kalyani@example.com', segment: 'biller', lands: 'No shift open' },
  staff: { email: 'staff.kalyani@example.com', segment: 'staff', lands: 'Hello, Synthetic Staff' },
} as const

/**
 * A fresh person per call, so the suite is re-runnable without resetting the
 * database. The **display name** has to be unique too, not just the address:
 * the accounts these tests create are never cleaned up, so a second run
 * against the same database would otherwise find three "E2E New Starter" rows
 * and every row locator would go ambiguous.
 */
const RUN = `${Date.now().toString(36)}`
let seq = 0
function freshPerson(label: string): { email: string; name: string; staffCode: string } {
  const id = `${RUN}-${seq++}`
  return {
    email: `e2e.${label}.${id}@example.com`,
    name: `E2E ${label} ${id}`,
    // Unique per run for the same reason the address is: a staff code is
    // unique per outlet, and this suite writes to a database it does not reset.
    staffCode: `E2E-${id}`.toUpperCase(),
  }
}

/** Fills the form and submits. Says nothing about whether it worked. */
async function attemptSignIn(page: Page, email: string, password: string) {
  await page.goto('sign-in')
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

/**
 * Signs in and waits until the session is actually established. Leaving the
 * sign-in URL is the signal: a `page.goto` issued before then is a full
 * navigation that can outrun the token being persisted, and the app would
 * quite correctly find nobody signed in.
 *
 * The URL rather than the button, deliberately — the button relabels itself
 * to "Signing in…" while the request is in flight, so waiting for it to
 * disappear succeeds immediately and proves nothing.
 */
async function signIn(page: Page, email: string, password = PASSWORD) {
  await attemptSignIn(page, email, password)
  await expect(page).not.toHaveURL(/\/sign-in$/)
}

async function signOut(page: Page) {
  await page.getByTestId('account-menu').click()
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/sign-in$/)
}

test.describe('signing in', () => {
  for (const [label, persona] of Object.entries(PERSONAS)) {
    test(`a ${label} signs in and lands on their own shell`, async ({ page }) => {
      await signIn(page, persona.email)

      await expect(page).toHaveURL(new RegExp(`/${persona.segment}$`))
      await expect(page.getByText(persona.lands)).toBeVisible()
      // Signed in, and it says who: the account menu is in every shell's chrome.
      await expect(page.getByTestId('account-menu')).toBeVisible()
      // And demo chrome is nowhere near a real session.
      await expect(page.getByTestId('demo-banner')).toHaveCount(0)
    })
  }

  test('a wrong password is refused, and says nothing about the address', async ({ page }) => {
    await attemptSignIn(page, PERSONAS.owner.email, 'not-the-password')
    await expect(page.getByTestId('signin-error')).toHaveText(
      'That email or password is not right.',
    )

    // An address with no account produces exactly the same sentence.
    await attemptSignIn(page, 'nobody-at-all@example.com', 'not-the-password')
    await expect(page.getByTestId('signin-error')).toHaveText(
      'That email or password is not right.',
    )
    await expect(page).toHaveURL(/\/sign-in$/)
  })

  test('another role’s path redirects to your own shell', async ({ page }) => {
    await signIn(page, PERSONAS.staff.email)
    await expect(page).toHaveURL(/\/staff$/)

    await page.goto('owner')
    await expect(page).toHaveURL(/\/staff$/)
    await expect(page.getByText(PERSONAS.staff.lands)).toBeVisible()

    // And the owner's surfaces are not reachable by naming them either.
    await page.goto('staff/people')
    await expect(page.getByText('That page does not exist')).toBeVisible()
  })

  test('a deep link survives the trip through sign-in', async ({ page }) => {
    await page.goto('admin/people')
    await expect(page).toHaveURL(/\/sign-in$/)

    await page.getByLabel('Email', { exact: true }).fill(PERSONAS.admin.email)
    await page.getByLabel('Password').fill(PASSWORD)
    await page.getByRole('button', { name: 'Sign in' }).click()

    await expect(page).toHaveURL(/\/admin\/people$/)
    await expect(page.getByRole('heading', { name: 'Access' })).toBeVisible()
  })

  test('the session survives a reload, and sign-out ends it', async ({ page }) => {
    await signIn(page, PERSONAS.admin.email)
    await expect(page).toHaveURL(/\/admin$/)

    await page.reload()
    await expect(page.getByText(PERSONAS.admin.lands)).toBeVisible()

    // The landing page does not detain someone who is already signed in.
    await page.goto('.')
    await expect(page).toHaveURL(/\/admin$/)

    await signOut(page)
    await page.goto('admin')
    await expect(page).toHaveURL(/\/sign-in$/)
  })
})

test.describe('provisioning, end to end', () => {
  test('an admin creates an account, hands over the code, and the person signs in', async ({
    page,
    browser,
  }) => {
    const person = freshPerson('starter')

    await signIn(page, PERSONAS.admin.email)
    await page.goto('admin/people')
    await expect(page.getByRole('heading', { name: 'Access' })).toBeVisible()

    await page.getByRole('button', { name: 'Add account' }).click()
    await page.getByLabel('Full name').fill(person.name)
    await page.getByLabel('Email', { exact: true }).fill(person.email)

    // Provisioning an Employee asks about the staff list, and refuses to write
    // a roster row with no staff code rather than inventing one. Answering it
    // is what makes this account a person who can actually check in, so the
    // walk answers it — against the real database, through the real form.
    await page.getByRole('button', { name: 'Create and issue a code' }).click()
    await expect(page.getByTestId('accounts-error')).toContainText('A staff code is needed')
    await page.getByLabel('Staff code').fill(person.staffCode)
    await page.getByRole('button', { name: 'Create and issue a code' }).click()

    const panel = page.getByTestId('issued-code')
    await expect(panel).toBeVisible()
    // The link is the whole handover, so it is what the walk uses. It carries
    // the code and never the address.
    const link = (await panel.getByTestId('issued-code-link').innerText()).trim()
    const code = new URL(link).searchParams.get('code')!
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/)
    expect(link).not.toContain('@')
    await expect(panel).toContainText('Shown once')
    await expect(panel.getByRole('img', { name: new RegExp(person.name) })).toBeVisible()

    // The new account is listed, and honestly described as not yet activated.
    await expect(page.getByRole('row', { name: person.name })).toContainText('Awaiting activation')

    // The code is gone the moment it is dismissed — there is nowhere to look
    // it up, because only a hash was ever stored.
    await panel.getByRole('button', { name: 'Done' }).click()
    await page.reload()
    await expect(page.getByTestId('issued-code')).toHaveCount(0)
    await expect(page.getByText(code)).toHaveCount(0)

    // A different person, on a different device, opening the message they were
    // sent. One tap, one field.
    const context = await browser.newContext()
    const theirPhone = await context.newPage()
    await theirPhone.goto(link)

    // The address is shown for them to recognise, never asked for.
    await expect(theirPhone.getByTestId('activate-address')).toHaveText(person.email)
    await expect(theirPhone.getByLabel('Email', { exact: true })).toHaveCount(0)
    await expect(theirPhone.getByLabel('One-time code')).toHaveCount(0)

    await theirPhone.getByRole('button', { name: /Yes, that/ }).click()
    await theirPhone.getByLabel('New password').fill(NEW_PASSWORD)
    await theirPhone.getByLabel('Confirm password').fill(NEW_PASSWORD)
    await theirPhone.getByRole('button', { name: 'Set password and sign in' }).click()

    await expect(theirPhone).toHaveURL(/\/staff$/)
    await expect(theirPhone.getByText(`Hello, ${person.name}`)).toBeVisible()

    // The whole point of the chain: an account provisioned minutes ago, on a
    // roster row created in the same breath, arrives at a working check-in
    // rather than at "you are not on the staff list". That sentence is what a
    // real employee saw before outlet-and-staff-setup, and it is the one thing
    // no earlier test could have caught — the fixtures were always pre-linked.
    await expect(theirPhone.getByTestId('attendance-action')).toBeVisible()
    await expect(theirPhone.getByText(/not on .* staff list/)).toHaveCount(0)

    // The code is spent: a second person forwarded the same message gets
    // nowhere — and is told so on arrival, before typing anything, because the
    // link is checked the moment it opens.
    const replayContext = await browser.newContext()
    const replay = await replayContext.newPage()
    await replay.goto(link)
    await expect(replay.getByTestId('activate-error')).toContainText('no longer usable')
    await expect(replay.getByLabel('New password')).toHaveCount(0)

    await context.close()
    await replayContext.close()
  })

  test('a manager cannot give anyone more than their own outlet', async ({ page }) => {
    await signIn(page, PERSONAS.admin.email)
    await page.goto('admin/people')

    await page.getByRole('button', { name: 'Add account' }).click()
    await expect(page.getByLabel('Role').locator('option')).toHaveText(['Biller', 'Staff'])
    await expect(page.getByLabel('Outlet')).toBeDisabled()

    // Their list is their outlet's, whatever the owner can see.
    await expect(page.getByRole('columnheader', { name: 'Outlet' })).toHaveCount(0)
    await expect(page.getByRole('row', { name: /Synthetic Admin Kpa/ })).toHaveCount(0)
  })
})

test.describe('deactivation', () => {
  test('ends an open session without waiting for the token to expire', async ({
    page,
    browser,
  }) => {
    const person = freshPerson('doomed')

    // The owner provisions someone…
    await signIn(page, PERSONAS.owner.email)
    await page.goto('owner/people')
    await page.getByRole('button', { name: 'Add account' }).click()
    await page.getByLabel('Full name').fill(person.name)
    await page.getByLabel('Email', { exact: true }).fill(person.email)
    await page.getByLabel('Outlet').selectOption({ label: 'Shawarmania Kalyani' })
    // A login, not a payroll employee — which is a real answer to the staff-list
    // question and the one this test wants, since deactivation is about the
    // session and nothing else. It also means the third option is exercised
    // against the real database somewhere.
    await page.getByLabel('Not on the staff list').check()
    await page.getByRole('button', { name: 'Create and issue a code' }).click()

    const link = (await page.getByTestId('issued-code-link').innerText()).trim()

    // …who activates on their own phone and is happily signed in.
    const context = await browser.newContext()
    const theirPhone = await context.newPage()
    await theirPhone.goto(link)
    await theirPhone.getByRole('button', { name: /Yes, that/ }).click()
    await theirPhone.getByLabel('New password').fill(NEW_PASSWORD)
    await theirPhone.getByLabel('Confirm password').fill(NEW_PASSWORD)
    await theirPhone.getByRole('button', { name: 'Set password and sign in' }).click()
    await expect(theirPhone).toHaveURL(/\/staff$/)

    // The owner deactivates them while that phone is still open.
    await page.getByTestId('issued-code').getByRole('button', { name: 'Done' }).click()
    const row = page.getByRole('row', { name: person.name })
    await row.getByRole('button', { name: 'Deactivate' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('immediately')
    await dialog.getByRole('button', { name: 'Deactivate' }).click()
    await expect(row).toContainText('Deactivated')

    // Back on the phone. Firing visibilitychange is what a real tab-return
    // does; the point is that the session ends on the NEXT check rather than
    // when the hour-long token expires. (The database refusing the still-valid
    // token is proved directly in supabase/tests/rest/account-flows.test.ts.)
    await theirPhone.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))

    await expect(theirPhone).toHaveURL(/\/sign-in$/)
    await expect(theirPhone.getByTestId('session-ended')).toContainText(
      'Your account has been deactivated',
    )

    // And their password no longer gets them anywhere.
    await theirPhone.getByLabel('Email', { exact: true }).fill(person.email)
    await theirPhone.getByLabel('Password').fill(NEW_PASSWORD)
    await theirPhone.getByRole('button', { name: 'Sign in' }).click()
    await expect(theirPhone.getByTestId('session-ended')).toBeVisible()
    await expect(theirPhone).toHaveURL(/\/sign-in$/)

    await context.close()
  })
})

test.describe('demo mode alongside a real session', () => {
  test('still works, still warns, and still offers no sign-out', async ({ page }) => {
    await signIn(page, PERSONAS.owner.email)
    await expect(page).toHaveURL(/\/owner$/)

    // A signed-in user is stopped on the way in, exactly as design D5 of #3
    // requires — the guard now has a real session to find, not a fake one.
    await page.goto('demo/owner')
    await expect(page.getByTestId('demo-interstitial')).toBeVisible()

    await page.getByRole('button', { name: 'Continue to demo' }).click()
    await expect(page.getByTestId('demo-banner')).toBeVisible()
    await expect(page.getByTestId('account-menu')).toHaveCount(0)

    // The promoted People surface runs on fixtures in demo mode.
    await page.goto('demo/owner/people')
    await expect(page.getByText('Demo Manager', { exact: true })).toBeVisible()
    await expect(page.getByTestId('demo-banner')).toBeVisible()
  })
})
