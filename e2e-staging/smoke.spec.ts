import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'

/**
 * Staging's smoke suite (a-release-can-be-switched-off, design D19): what
 * Staging runs after every publish, and what an agent runs when asked to verify
 * on staging. It works only at *Smoke tests*, the outlet `scripts/seed-staging.mjs`
 * made for it, as that outlet's own manager and biller, so *Test Cafe* and its
 * accounts stay the owner's: nothing the owner is trying on the fake outlet is
 * rung over, left or removed by a push.
 *
 * The manager sets up a counter and a kitchen tablet with setup codes, as an
 * owner would, and they meet only at the server, as they would at the outlet:
 * the counter's shift opened by the two-device handshake from the biller's
 * phone, the kitchen's from the manager's, one order rung, acknowledged in the
 * kitchen and paid. Both shifts are left and both tablets removed at the end,
 * and any a crashed run left are removed first, so the outlet's Tablets list is
 * empty between runs. Then the owner turns the probe change gate on and back off
 * from the Change gates page, restoring whatever it found: gates are
 * business-wide, the one thing this run shares with the owner. The staging band
 * is checked on every screen.
 *
 * Passwords come from the environment — `STAGING_TEST_PASSWORD` locally, the
 * `staging-smoke` GitHub environment in CI — and never from this repository.
 */

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} must be set to run the staging smoke suite.`)
  return value
}

const PASSWORD = required('STAGING_TEST_PASSWORD')

const BAND = 'Staging · not a real outlet'

/** The seed's *Smoke tests* outlet, and a suffix that names this run's tablets. */
const SMOKE_OUTLET = '5a000000-0000-4000-a000-000000000002'
const RUN = Date.now().toString(36).slice(-6)
const SUITE_TABLET = /^Remove Smoke (counter|kitchen) /

/** A phone signed in as a person, through the sign-in screen. */
async function phone(
  browser: Browser,
  username: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await context.newPage()
  await page.goto('sign-in')
  await expect(page.getByText(BAND)).toBeVisible()
  await page.getByLabel('Username or email', { exact: true }).fill(username)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).not.toHaveURL(/\/sign-in$/)
  await expect(page.getByText(BAND)).toBeVisible()
  return { context, page }
}

/** The manager's phone on *Smoke tests*, once its tablets have been read. */
async function smokeTablets(manager: Page) {
  await manager.goto(`admin/outlets/${SMOKE_OUTLET}`)
  await expect(manager.getByText(BAND)).toBeVisible()
  await expect(manager.getByRole('button', { name: 'Re-read the tablets' })).toBeVisible({
    timeout: 30_000,
  })
}

/** Removes every tablet this suite set up, including any a crashed run left behind. */
async function removeSuiteTablets(manager: Page) {
  await smokeTablets(manager)
  const remove = manager.getByRole('button', { name: SUITE_TABLET })
  while ((await remove.count()) > 0) {
    const before = await remove.count()
    await remove.first().click()
    await manager
      .getByRole('dialog', { name: /^Remove Smoke / })
      .getByRole('button', { name: 'Remove', exact: true })
      .click()
    await expect(remove).toHaveCount(before - 1, { timeout: 30_000 })
  }
}

/**
 * A fresh browser made a tablet the way an owner makes one: the manager generates
 * a setup code on their phone and it is typed on the tablet.
 */
async function setUpTablet(
  browser: Browser,
  manager: Page,
  label: string,
  use: 'Billing' | 'Kitchen',
): Promise<{ context: BrowserContext; page: Page }> {
  await manager.getByTestId('add-tablet').click()
  const sheet = manager.getByRole('dialog', { name: 'Set up a tablet at Smoke tests' })
  await sheet.getByLabel('What to call it').fill(label)
  await sheet.getByRole('radio', { name: use, exact: true }).click()
  await sheet.getByRole('button', { name: 'Generate a code' }).click()
  const code = (await manager.getByTestId('tablet-setup-code').textContent())?.trim() ?? ''
  expect(code, 'no setup code was shown').not.toBe('')
  await manager.getByRole('button', { name: 'Done', exact: true }).click()

  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()
  await page.goto('counter/setup')
  await expect(page.getByText(BAND)).toBeVisible()
  await page.getByLabel('Setup code').fill(code)
  await page.getByRole('button', { name: 'Set up', exact: true }).click()
  await expect(page).toHaveURL(use === 'Kitchen' ? /\/kitchen$/ : /\/counter$/, {
    timeout: 30_000,
  })
  await expect(page.getByText(BAND)).toBeVisible()
  return { context, page }
}

/** The handshake: the tablet asks for a person, who types its code on their own phone. */
async function openShift(
  tabletPage: Page,
  person: Page,
  username: string,
  job: 'counter' | 'kitchen',
) {
  await tabletPage.getByLabel('Username').fill(username)
  await tabletPage.getByRole('button', { name: `Ask to open the ${job}` }).click()
  const code = (await tabletPage.getByTestId('counter-shift-code').textContent())?.trim() ?? ''
  expect(code).toMatch(/^\d{4}$/)

  await person.goto('.')
  const card = person.getByTestId('counter-request-card')
  await card.getByLabel('Code on the tablet').fill(code)
  await card.getByRole('button', { name: `Open ${job}` }).click()
  await expect(card).toHaveCount(0)
}

async function leaveShift(person: Page, job: 'counter' | 'kitchen') {
  await person.goto('.')
  const label = job === 'kitchen' ? 'Leave kitchen' : 'Leave counter'
  await person.getByTestId('counter-shift-card').getByRole('button', { name: label }).click()
  await person.getByRole('dialog').getByRole('button', { name: label }).click()
  await expect(person.getByTestId('counter-shift-card')).toHaveCount(0)
}

/** A phone number no Indian mobile uses, new on every run. */
const customerPhone = () =>
  String(9_000_000_000 + ((Math.floor(Date.now() / 1000) * 10) % 999_000_000))

test('a counter and a kitchen set up on staging trade end to end, and the owner turns a change gate', async ({
  browser,
}) => {
  test.slow()

  const manager = await phone(browser, 'staging.smoke.manager')
  const biller = await phone(browser, 'staging.smoke.biller')
  const tablets: { context: BrowserContext }[] = []

  try {
    await removeSuiteTablets(manager.page)
    const counter = await setUpTablet(browser, manager.page, `Smoke counter ${RUN}`, 'Billing')
    tablets.push(counter)
    const kitchen = await setUpTablet(browser, manager.page, `Smoke kitchen ${RUN}`, 'Kitchen')
    tablets.push(kitchen)

    await openShift(counter.page, biller.page, 'staging.smoke.biller', 'counter')
    await expect(counter.page.getByTestId('menu-grid')).toBeVisible({ timeout: 30_000 })
    await openShift(kitchen.page, manager.page, 'staging.smoke.manager', 'kitchen')
    await expect(kitchen.page).toHaveURL(/\/kitchen$/)
    await expect(kitchen.page.getByTestId('kitchen-filter-summary')).toBeVisible({
      timeout: 30_000,
    })

    // One order, for a customer the counter has never seen.
    await counter.page.getByRole('button', { name: 'Smoke dish 1', exact: true }).click()
    await counter.page.getByTestId('customer-row').click()
    const customer = counter.page.getByRole('dialog', { name: 'Customer' })
    for (const digit of customerPhone()) {
      await customer.getByRole('button', { name: digit, exact: true }).click()
    }
    await customer.getByPlaceholder(/name/i).fill('Smoke Test')
    await customer.getByTestId('customer-confirm').click()
    await expect(customer).toHaveCount(0)
    const rail = counter.page.getByTestId('counter-activity-rail')
    const cardIds = () =>
      rail
        .locator('[data-flip-id]')
        .evaluateAll((cards) => cards.map((card) => card.getAttribute('data-flip-id')!))
    const before = new Set(await cardIds())
    await counter.page.getByRole('button', { name: 'Order', exact: true }).click()
    let id = ''
    await expect
      .poll(async () => (id = (await cardIds()).find((cardId) => !before.has(cardId)) ?? ''), {
        timeout: 30_000,
      })
      .not.toBe('')

    // The kitchen hears it and acknowledges it.
    const ticket = kitchen.page.locator(`[data-order-id="${id}"]`)
    await expect(ticket).toBeVisible({ timeout: 30_000 })
    await ticket.getByRole('button', { name: /^ACK order / }).click()
    await expect(ticket).toHaveAttribute('data-state', 'quiet')

    // The counter takes the payment.
    const card = rail.locator(`[data-flip-id="${id}"]`)
    await card.getByRole('button', { name: 'Paid', exact: true, pressed: false }).click()
    const payment = counter.page.getByRole('dialog', { name: 'Record payment' })
    await payment.getByRole('button', { name: 'Cash', exact: true }).click()
    await payment.getByRole('button', { name: 'Paid', exact: true }).click()
    await expect(counter.page.locator('dialog[open]')).toHaveCount(0)
    await expect(
      card.getByRole('button', { name: 'Paid', exact: true, pressed: true }),
    ).toBeVisible()
  } finally {
    await leaveShift(manager.page, 'kitchen').catch(() => undefined)
    await leaveShift(biller.page, 'counter').catch(() => undefined)
    // A failure here is left for the next run, which removes leftovers first.
    await removeSuiteTablets(manager.page).catch(() => undefined)
    for (const side of [...tablets, manager, biller]) await side.context.close()
  }

  // The owner turns the probe on and back off, as a release would.
  const owner = await phone(browser, 'staging.owner')
  try {
    await owner.page.goto('owner/change-gates/probe')
    await expect(owner.page.getByText(BAND)).toBeVisible()
    const since = owner.page.getByTestId('gate-since')
    const wasOn = /^On/.test((await since.textContent()) ?? '')
    for (const turnOn of wasOn ? [false, true] : [true, false]) {
      await owner.page.getByTestId('turn-gate').click()
      await owner.page.getByTestId('turn-reason').fill('Staging smoke suite')
      await owner.page.getByTestId('confirm-turn-submit').click()
      await expect(since).toContainText(turnOn ? /^On/ : /^Off/)
    }
  } finally {
    await owner.context.close()
  }
})

test('staging installs under its own name and its own icons', async ({ request, baseURL }) => {
  const base = baseURL ?? ''
  const manifest = (await (await request.get('manifest.webmanifest')).json()) as {
    short_name: string
    icons: { src: string }[]
  }
  expect(manifest.short_name).toBe('Staging')
  expect(manifest.icons.length).toBeGreaterThan(0)
  const page = await (await request.get('.')).text()
  const links = [...page.matchAll(/href="([^"]*\.png)"/g)].map((match) => match[1] ?? '')
  expect(links.length).toBeGreaterThan(0)
  // Resolved against the base, so a build served under a sub-path checks the same.
  for (const src of [...manifest.icons.map((icon) => icon.src), ...links]) {
    const url = new URL(src, base)
    expect(url.pathname, src).toMatch(/\/icons\/staging\/[a-z0-9-]+\.png$/)
    const icon = await request.get(url.href)
    expect(icon.status(), src).toBe(200)
    expect(icon.headers()['content-type'], src).toContain('image/png')
  }
})
