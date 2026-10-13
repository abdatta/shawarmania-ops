import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'

/**
 * Staging's smoke suite (a-release-can-be-switched-off, design D19): what
 * Staging runs after every publish, and what an agent runs when asked to verify
 * on staging. It writes only to *Test Cafe*, the outlet `scripts/seed-staging.mjs`
 * made, and signs in only as its test accounts and tablets.
 *
 * The owner, the manager, a counter and a kitchen meet only at the server, as
 * they would at the outlet: the counter's shift opened by the two-device
 * handshake from the Biller's phone, the kitchen's from the manager's, one
 * order rung, acknowledged in the kitchen and paid, and the probe change gate
 * turned on and back off from the owner's Change gates page. The staging band is
 * checked on every screen. Both shifts are left at the end, so staging is as
 * the run found it.
 *
 * Passwords come from the environment — `STAGING_TEST_PASSWORD` locally, the
 * `staging-smoke` GitHub environment in CI — and never from this repository.
 */

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} must be set to run the staging smoke suite.`)
  return value
}

const SUPABASE_URL = required('STAGING_SUPABASE_URL')
const ANON_KEY = required('STAGING_SUPABASE_ANON_KEY')
const PASSWORD = required('STAGING_TEST_PASSWORD')

const BAND = 'Staging · not a real outlet'

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

/** A seeded tablet, signed in as the machine it is, the way a set-up tablet holds its session. */
async function tablet(
  browser: Browser,
  username: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ email: `${username}@login.shawarmania.invalid`, password: PASSWORD }),
  })
  expect(response.ok, `${username} could not sign in`).toBe(true)
  const session = (await response.json()) as Record<string, unknown>
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()
  await page.addInitScript((value) => {
    localStorage.setItem('shawarmania.auth', JSON.stringify(value))
  }, session)
  await page.goto('counter')
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

test('Test Cafe trades end to end on staging, and the owner turns a change gate', async ({
  browser,
}) => {
  test.slow()

  const biller = await phone(browser, 'staging.biller')
  const manager = await phone(browser, 'staging.manager')
  const counter = await tablet(browser, 'staging.counter')
  const kitchen = await tablet(browser, 'staging.kitchen')

  try {
    await openShift(counter.page, biller.page, 'staging.biller', 'counter')
    await expect(counter.page.getByTestId('menu-grid')).toBeVisible({ timeout: 30_000 })
    await openShift(kitchen.page, manager.page, 'staging.manager', 'kitchen')
    await expect(kitchen.page).toHaveURL(/\/kitchen$/)
    await expect(kitchen.page.getByTestId('kitchen-filter-summary')).toBeVisible({
      timeout: 30_000,
    })

    // One order, for a customer the counter has never seen.
    await counter.page.getByRole('button', { name: 'Test dish 1', exact: true }).click()
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
    for (const side of [counter, kitchen, manager, biller]) await side.context.close()
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
