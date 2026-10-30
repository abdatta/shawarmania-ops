import { type Page } from '@playwright/test'
import { expect, test } from './test'
import { DEMO_GRILLER_ACCOUNT_ID } from '../src/data-access/mock/fixtures/accounts'
import { E2E_ORIGIN } from '../ports'
import { OUTLET_KALYANI_ID } from '../src/data-access/mock/fixtures/outlets'

/**
 * A check-in at the shop approves itself, and the staff screens drawn around it
 * (a-check-in-at-the-shop-approves-itself, #81), against a production build and
 * a real browser. These are the `@cg-on` twins of the attendance walk's specs
 * that assert today's every-day-waits rule and today's screens; those are
 * tagged `@cg-off` where they stand.
 *
 * Geolocation is Playwright's own emulation, as in `attendance.spec.ts`, so a
 * check-in from away is produced by standing in the wrong place. The demo's
 * place switch is left on *This device* throughout.
 *
 * baseURL carries the deployment sub-path, so every goto is relative.
 */

/** Kalyani's counter, from the outlet fixture. */
const AT_COUNTER = { latitude: 22.97505, longitude: 88.4346 }
/** ~240 m away: outside the 150 m fence. */
const DOWN_THE_ROAD = { latitude: 22.9765, longitude: 88.4362 }

const AUTO = { tag: '@cg-on:auto-approve-at-the-shop' }
const SCREENS = { tag: '@cg-on:refreshed-staff-screens' }

test.use({ permissions: ['geolocation'], geolocation: AT_COUNTER })

/** A fixed mid-month instant, for the specs that read a month (see `attendance.spec.ts`). */
const MID_MONTH = new Date('2026-07-20T12:00:00+05:30')

async function openStaffHome(page: Page) {
  await page.goto('demo/staff')
  await expect(page.getByTestId('today-pass')).toBeVisible()
}

/** Move between roles in the same tab, so the demo store keeps what was done. */
async function switchRole(page: Page, role: 'Owner' | 'Admin' | 'Biller' | 'Staff') {
  await page
    .getByRole('navigation', { name: 'Demo role switcher' })
    .getByRole('link', { name: role })
    .click()
}

test(
  'a check-in at the counter is approved at once, with nothing to decide',
  AUTO,
  async ({ page }) => {
    await openStaffHome(page)
    await page.getByTestId('attendance-action').click()

    // No popup: inside the fence there is no decision to make.
    const day = page.getByTestId('today-pass-day')
    await expect(day).toHaveAttribute('data-state', 'approved')
    await expect(page.getByTestId('today-pass-approved')).toBeVisible()
    await expect(page.getByTestId('check-in-steps')).toHaveCount(0)
    // And nothing left to press.
    await expect(page.getByTestId('attendance-action')).toHaveCount(0)
    await expect(page.getByTestId('attendance-retry')).toHaveCount(0)
  },
)

test(
  'a check-in from away asks, explains, and Not now writes nothing',
  SCREENS,
  async ({ page, context }) => {
    await context.setGeolocation(DOWN_THE_ROAD)
    await openStaffHome(page)
    await page.getByTestId('attendance-action').click()

    const away = page.getByTestId('attendance-blocked')
    await expect(away).toBeVisible()
    // Named, because the demo Employee works at two outlets.
    await expect(away).toContainText('You don’t seem to be at Shawarmania Kalyani')
    await expect(away).toContainText('Your manager will need to approve it.')
    // The numbers are behind Why?, not in the way.
    await away.getByText('Why?').click()
    await expect(away).toContainText('150 m')

    await page.getByTestId('attendance-not-now').click()
    await expect(away).toHaveCount(0)
    await page.reload()
    await expect(page.getByTestId('attendance-action')).toHaveText(/Check in/)
  },
)

test('checking in anyway from away waits for the manager', SCREENS, async ({ page, context }) => {
  await context.setGeolocation(DOWN_THE_ROAD)
  await openStaffHome(page)
  await page.getByTestId('attendance-action').click()
  await page.getByTestId('request-override').click()

  await expect(page.getByTestId('today-pass-day')).toHaveAttribute('data-state', 'waiting')
  await expect(page.getByTestId('attendance-waiting')).toHaveText('Waiting for your manager')
  await expect(page.getByTestId('attendance-retry')).toHaveText(/Check my location again/)
})

test(
  'Block refuses a check-in from away, and says so with one OK',
  AUTO,
  async ({ page, context }) => {
    await page.goto(`demo/admin/outlets/${OUTLET_KALYANI_ID}`)
    const rules = page.getByTestId('attendance-rules-section')
    await expect(rules).toBeVisible()
    await page.getByTestId('attendance-blocks-away-switch').click()
    await page.getByTestId('attendance-rules-save').click()
    await expect(page.getByTestId('attendance-rules-saved')).toBeVisible()

    await context.setGeolocation(DOWN_THE_ROAD)
    await switchRole(page, 'Staff')
    await expect(page.getByTestId('today-pass')).toBeVisible()
    await page.getByTestId('attendance-action').click()

    const refused = page.getByTestId('attendance-refused')
    await expect(refused).toContainText('Check-in denied')
    await expect(refused).toContainText('You’re not at the shop. Ask your manager.')
    await expect(page.getByTestId('request-override')).toHaveCount(0)
    await expect(page.getByText('Check in again')).toHaveCount(0)

    await page.getByTestId('attendance-okay').click()
    await expect(refused).toHaveCount(0)
    await expect(page.getByTestId('attendance-action')).toBeVisible()
  },
)

test('the outlet page puts Attendance straight after Details', AUTO, async ({ page }) => {
  await page.goto(`demo/admin/outlets/${OUTLET_KALYANI_ID}`)
  const rules = page.getByTestId('attendance-rules-section')
  await expect(rules).toBeVisible()
  // The outlet's sections are the level-3 headings under its name.
  const headings = await page
    .getByRole('heading', { level: 3 })
    .evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim()))
  expect(headings.indexOf('Attendance')).toBe(headings.indexOf('Details') + 1)
})

test('the manager reads an auto-approved day with no approver', AUTO, async ({ page }) => {
  await page.goto('demo/admin/attendance')
  await expect(page.getByTestId('attendance-day')).toBeVisible()

  const card = page.getByTestId(`day-${DEMO_GRILLER_ACCOUNT_ID}`)
  const toggle = page.getByTestId(`expand-${DEMO_GRILLER_ACCOUNT_ID}`)
  if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click()
  await expect(card.getByTestId('auto-approved-note')).toContainText('Auto-approved at the shop')
  await expect(page.getByTestId(`approve-${DEMO_GRILLER_ACCOUNT_ID}`)).toHaveCount(0)
})

test('My attendance is a month calendar, and a day opens its detail', SCREENS, async ({ page }) => {
  await page.clock.setFixedTime(MID_MONTH)
  await page.goto('demo/staff/my-attendance')

  const calendar = page.getByTestId('attendance-calendar')
  await expect(calendar).toBeVisible()
  await expect(page.getByTestId('attendance-tally')).toBeVisible()
  await expect(calendar.getByTestId('late-clock').first()).toBeVisible()
  // A tab of its own: no Back.
  await expect(page.getByRole('link', { name: /Back/ })).toHaveCount(0)

  // Each business date once, whatever outlet it was worked at.
  const dates = await calendar
    .getByTestId(/^calendar-day-/)
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-testid')))
  expect(new Set(dates).size).toBe(dates.length)

  // A present day opens the same evidence the manager reads, approval included.
  await calendar.locator('[data-mark="present"]').first().click()
  const detail = page.getByTestId(/^calendar-detail-/)
  await expect(detail).toBeVisible()
  await expect(detail.getByTestId('approval-note')).toBeVisible()
})

test('By staff reads one person’s month as the same calendar', SCREENS, async ({ page }) => {
  await page.clock.setFixedTime(MID_MONTH)
  await page.goto('demo/admin/attendance')
  await expect(page.getByTestId('attendance-day')).toBeVisible()

  await page.getByTestId('axis-staff').click()
  await page.getByTestId('person-picker').selectOption('d1000000-0000-4000-a000-000000000004')

  await expect(page.getByTestId('attendance-tally')).toBeVisible()
  await expect(page.getByTestId('attendance-calendar')).toBeVisible()
  await expect(page.getByTestId('late-clock').first()).toBeVisible()
  await page.getByRole('button', { name: 'Previous month' }).click()
  await expect(page.getByTestId('range-picker')).toBeVisible()
})

test('a person at two outlets picks no outlet on Home', SCREENS, async ({ page }) => {
  await openStaffHome(page)
  // The one big button is the only thing to press: the fence resolves the shop.
  await expect(page.getByTestId('attendance-action')).toBeVisible()
  // The demo's own place switch is a select in the banner, not the app's.
  await expect(page.getByRole('main').getByRole('combobox')).toHaveCount(0)
  // No greeting and no Assigned to… on the new Home.
  await expect(page.getByText(/^Hello, /)).toHaveCount(0)
  await expect(page.getByText(/Assigned to/)).toHaveCount(0)
})

test(
  'the new staff screens make no request beyond the app origin',
  SCREENS,
  async ({ page, baseURL }) => {
    const origin = new URL(baseURL ?? E2E_ORIGIN).origin
    const violations: string[] = []
    page.on('request', (request) => {
      if (new URL(request.url()).origin !== origin) violations.push(request.url())
    })

    await openStaffHome(page)
    await page.getByTestId('attendance-action').click()
    await expect(page.getByTestId('today-pass-day')).toBeVisible()
    await page.goto('demo/staff/my-attendance')
    await expect(page.getByTestId('attendance-calendar')).toBeVisible()
    await page.goto('demo/staff/ledger/expenses')
    await expect(page.getByTestId('add-ledger-expense')).toBeVisible()
    await page.goto(`demo/admin/outlets/${OUTLET_KALYANI_ID}`)
    await expect(page.getByTestId('attendance-rules-section')).toBeVisible()

    expect(violations).toEqual([])
  },
)

/**
 * A recheck, on a fake clock (tasks 9.4): from away at 12:50 the day waits; a
 * recheck still away at 13:00 records nothing and says so; a recheck at the
 * shop at 13:10, after Kalyani's 13:00 deadline, approves the day as late with
 * no confirmation, and leaves no button.
 */
test(
  'a recheck from the shop after the deadline approves the day as late',
  SCREENS,
  async ({ page, context }) => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())
    await page.clock.install({ time: new Date(`${today}T12:50:00+05:30`) })
    await context.setGeolocation(DOWN_THE_ROAD)
    await openStaffHome(page)

    await page.getByTestId('attendance-action').click()
    await page.getByTestId('request-override').click()
    await expect(page.getByTestId('attendance-waiting')).toBeVisible()

    await page.clock.fastForward('10:00')
    await page.getByTestId('attendance-retry').click()
    const missed = page.getByTestId('recheck-missed')
    await expect(missed).toContainText('Still not at the shop')
    await expect(page.getByTestId('check-in-steps')).toHaveCount(0)
    await page.clock.fastForward('00:04')
    await expect(missed).toHaveCount(0)
    await expect(page.getByTestId('attendance-retry')).toBeVisible()

    await page.clock.fastForward('10:00')
    await context.setGeolocation(AT_COUNTER)
    await page.getByTestId('attendance-retry').click()
    await expect(page.getByTestId('today-pass-day')).toHaveAttribute('data-state', 'approved')
    await expect(page.getByTestId('today-pass-day').getByTestId('late-tag')).toBeVisible()
    // No "Use this new check-in?" on the way, and nothing to press after.
    await expect(page.getByTestId('check-in-steps')).toHaveCount(0)
    await expect(page.getByTestId('attendance-retry')).toHaveCount(0)
  },
)

/**
 * The expense list on the refreshed screens (tasks 9.3), on the counter tablet
 * and on the staff phone, which draw one component.
 */
for (const where of [
  // The tablet's list is the running day alone, so it has no day headings.
  { label: 'the counter tablet', path: 'demo/biller', days: false },
  { label: 'the staff phone', path: 'demo/staff/ledger/expenses', days: true },
]) {
  test(
    `expenses on ${where.label}: ${where.days ? 'day headings, ' : ''}mine tagged, amount first`,
    SCREENS,
    async ({ page }) => {
      await page.goto(where.path)
      const list = page.getByTestId('ledger-expense-list')
      await expect(list).toBeVisible()
      if (where.days) {
        await expect(list.getByTestId(/^expense-day-/).first()).toBeVisible()
        await expect(list.getByTestId(/^ledger-expense-date-/)).toHaveCount(0)
      }
      await expect(list.getByTestId(/^ledger-cash-/).first()).toHaveText(/Cash/)

      await page.getByTestId('add-ledger-expense').click()
      const sheet = page.getByRole('dialog', { name: 'Add expense' })
      await expect(sheet).toBeVisible()
      const first = await sheet.getByRole('textbox').first().getAttribute('id')
      expect(first).toBe('expense-amount')
      await expect(sheet.getByTestId('expense-description')).toHaveAttribute(
        'placeholder',
        'What was it for?',
      )

      // What the reader records is tagged as theirs.
      await sheet.getByTestId('expense-amount').fill('45')
      // The suite runs every gate on, so the category is a tile from the
      // owners' list (design D11); Other carries what it was.
      await sheet.getByRole('radio', { name: 'Other' }).click()
      await sheet.getByTestId('expense-description').fill('Lemons')
      await sheet.getByRole('button', { name: 'Record expense' }).click()
      await expect(sheet).toHaveCount(0)
      const mine = list.getByRole('listitem').filter({ hasText: 'Lemons' })
      await expect(mine.getByTestId(/^expense-you-/)).toHaveText('You')
    },
  )
}

/** The staff shell's cells of `demo-screens.spec.ts`, anchored on the Today pass. */
for (const viewport of [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 1080, height: 810 },
] as const) {
  for (const theme of ['light', 'dark'] as const) {
    test(
      `the staff shell renders the Today pass in ${theme} on ${viewport.name}`,
      SCREENS,
      async ({ page }, testInfo) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height })
        await page.goto('.')
        await page.evaluate((value) => localStorage.setItem('shawarmania.theme', value), theme)
        await page.goto('demo/staff')
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
        await expect(page.getByTestId('demo-banner')).toBeVisible()
        await expect(page.getByTestId('today-pass')).toBeVisible()
        await testInfo.attach(`staff-${theme}-${viewport.name}`, {
          body: await page.screenshot(),
          contentType: 'image/png',
        })
      },
    )
  }
}

test('a staff deep link reconstructs the Today pass on reload', SCREENS, async ({ page }) => {
  await page.goto('demo/staff')
  await expect(page.getByTestId('today-pass')).toBeVisible()
  await page.reload()
  await expect(page.getByTestId('today-pass')).toBeVisible()
  await expect(page.getByTestId('demo-banner')).toBeVisible()
})
