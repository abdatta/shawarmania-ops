import { expect, test, type Page } from '@playwright/test'
import {
  DEMO_KANCHRAPARA_STAFF_ACCOUNT_ID,
  DEMO_RUNNER_ACCOUNT_ID,
} from '../src/data-access/mock/fixtures/accounts'
import { OUTLET_KALYANI_ID, OUTLET_KANCHRAPARA_ID } from '../src/data-access/mock/fixtures/outlets'
import { DEMO_OWNER_ID } from '../src/data-access/mock/fixtures/personas'

/**
 * The attendance walk, against a production build and a real browser.
 *
 * Geolocation is granted and set through Playwright's own emulation rather
 * than through any test hook in the app — so what runs here is the same
 * `navigator.geolocation` path a phone takes, and a blocked check-in is
 * produced by genuinely standing in the wrong place.
 *
 * baseURL carries the deployment sub-path, so every goto is relative.
 */

/** Kalyani's counter, from the outlet fixture. */
const AT_COUNTER = { latitude: 22.97505, longitude: 88.4346 }
/** ~240 m away: outside the 150 m fence, but plausibly a drifting fix. */
const DOWN_THE_ROAD = { latitude: 22.9765, longitude: 88.4362 }

test.use({ permissions: ['geolocation'], geolocation: AT_COUNTER })

/**
 * A fixed mid-month instant, for the two specs that read a **range** of days.
 *
 * Both person views default to the current month, deliberately (owner,
 * 2026-08-01): on the first of a month that month really is empty, and saying so
 * is the honest answer rather than a bug. But the demo's attendance fixtures are
 * authored as business days back from today, so on the 1st the pattern sits in
 * the previous month and these specs would assert against an empty — and
 * correct — screen.
 *
 * So the test owns the clock instead of the product bending to the test.
 * `setFixedTime` pins `Date` only; timers keep running, so nothing in the app
 * stalls. Anything asserting *today* is left alone: those specs are about a day,
 * and a day is never empty of meaning.
 */
const MID_MONTH = new Date('2026-07-20T12:00:00+05:30')

/**
 * Open every collapsed day on screen.
 *
 * A day is a headline until somebody opens it, unless it is waiting for a
 * manager — those are already open, because they are the rows the screen exists
 * to settle. Anything asserting on the evidence, the approval or the manual
 * entry of a settled day has to ask for it first.
 */
async function openEveryDay(page: Page) {
  const toggles = page.getByTestId(/^expand-/)
  for (let index = 0; index < (await toggles.count()); index += 1) {
    const toggle = toggles.nth(index)
    if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click()
  }
}

async function openStaffHome(page: Page) {
  await page.goto('demo/staff')
  await expect(page.getByText('Hello, Demo Staff')).toBeVisible()
}

test('an employee checks in at the counter, and the day waits for a manager', async ({ page }) => {
  await openStaffHome(page)

  const action = page.getByTestId('attendance-action')
  await expect(action).toHaveText(/Check in/)
  await action.click()

  // Standing at the counter, inside the fence, and still counting for nothing.
  // The screen has to say so rather than imply the day is done.
  await expect(page.getByTestId('attendance-waiting')).toContainText(
    'waiting for your manager to approve it',
  )
  await expect(page.getByText(/from the outlet/)).toBeVisible()
  await expect(page.getByTestId('attendance-blocked')).toHaveCount(0)
  await expect(page.getByText('Waiting for a manager to approve')).toBeVisible()
})

test('a check-in from outside the fence is refused, explained, and writes nothing', async ({
  page,
  context,
}) => {
  await context.setGeolocation(DOWN_THE_ROAD)
  await openStaffHome(page)

  await page.getByTestId('attendance-action').click()

  const blocked = page.getByTestId('attendance-blocked')
  await expect(blocked).toBeVisible()
  // Named, because the demo Employee works at two outlets since
  // multi-outlet-people and "the outlet" would mean nothing to them. The fence
  // picked the nearer one, which is whose manager will be asked.
  await expect(blocked).toContainText('too far from Shawarmania Kalyani')
  // The numbers a person needs to argue with it: distance, limit, and how
  // sure the phone was.
  await expect(blocked).toContainText('150 m')
  await expect(blocked).toContainText(/±\d+/)
  // And what it will cost the manager who settles it, so the person asking
  // knows what they are asking for.
  await expect(blocked).toContainText('will have to give a reason')

  // Walking away records nothing at all.
  await page.getByRole('button', { name: 'Not now' }).click()
  await expect(page.getByTestId('attendance-blocked')).toHaveCount(0)
  await page.reload()
  await expect(page.getByTestId('attendance-action')).toHaveText(/Check in/)
})

test('a blocked check-in becomes a request the manager can approve', async ({ page, context }) => {
  await context.setGeolocation(DOWN_THE_ROAD)
  await openStaffHome(page)

  await page.getByTestId('attendance-action').click()
  await page.getByTestId('request-override').click()

  // Claimed present, stored absent, and said in words.
  await expect(page.getByText('Waiting for a manager to approve')).toBeVisible()
})

test('a manager standing at the counter approves a waiting day in one tap', async ({ page }) => {
  await page.goto('demo/admin/attendance')

  const day = page.getByTestId('attendance-day')
  await expect(day).toBeVisible()
  await expect(page.getByTestId('day-waiting')).toBeVisible()

  // The browser's emulated position is AT_COUNTER, and the day being settled is
  // today's — so the honest path is exactly one tap, with no sheet at all.
  await page.getByTestId(`approve-${DEMO_RUNNER_ACCOUNT_ID}`).click()

  const card = page.getByTestId(`day-${DEMO_RUNNER_ACCOUNT_ID}`)
  await expect(card.getByTestId('approval-note')).toContainText('Demo Manager,')
  await expect(card.getByTestId('approver-place')).toContainText('on site')
  await expect(page.getByLabel('Why are you approving this?')).toHaveCount(0)
})

test('approving from away from the outlet costs a reason, and records it', async ({
  page,
  context,
}) => {
  await context.setGeolocation(DOWN_THE_ROAD)
  await page.goto('demo/admin/attendance')
  await expect(page.getByTestId('attendance-day')).toBeVisible()

  await page.getByTestId(`approve-${DEMO_RUNNER_ACCOUNT_ID}`).click()

  // Not refused — asked. A visible off-site approval is better oversight than a
  // refusal a manager routes around by telephone.
  await expect(page.getByTestId('reason-required')).toContainText('You are not at the outlet')
  await page.getByLabel('Why are you approving this?').fill('At the counter, phone signal poor')
  await page.getByRole('button', { name: /Approve and record my reason/ }).click()

  const card = page.getByTestId(`day-${DEMO_RUNNER_ACCOUNT_ID}`)
  await expect(card.getByTestId('approval-note')).toContainText('At the counter, phone signal poor')
  // The chip names itself to a screen reader and shows the distance to
  // everybody else, since the card became chips (design D9).
  await expect(card.getByTestId('approver-place')).toContainText('Approver:')
})

test('the navigation carries the count, and doing the work takes it away', async ({ page }) => {
  await page.goto('demo/admin')

  // Read from a screen that is not attendance, which is the whole point: the
  // person who could settle a day is rarely already looking at the day.
  const nav = page.getByRole('navigation', { name: 'Primary' }).first()
  const badge = nav.getByTestId('nav-badge-attendance-waiting')
  // Three unsettled at Kalyani: two this morning and one five days back.
  await expect(badge).toContainText('3 arrivals waiting for approval')

  await nav.getByRole('link', { name: 'Attendance' }).click()
  await expect(page.getByTestId('attendance-day')).toBeVisible()

  // The tab counts every unsettled day; the day badge counts only the day on
  // screen. The difference between the two is the older day, and the mark on
  // the earlier-days control is what says so.
  await expect(page.getByTestId('day-waiting')).toContainText('2 arrivals waiting for approval')
  await expect(page.getByTestId('earlier-days-waiting')).toBeVisible()
  await expect(page.getByTestId('later-days-waiting')).toHaveCount(0)

  const waiting = page.getByTestId(/^approve-[0-9a-f-]{36}$/)
  await waiting.first().click()
  await expect(badge).toContainText('2 arrivals waiting for approval')
  await waiting.first().click()
  await expect(badge).toContainText('1 arrival waiting for approval')

  // Today is settled and its badge has gone. The tab's has not, because there
  // is still a day behind this one that nobody has looked at.
  await expect(page.getByTestId('day-waiting')).toHaveCount(0)
  await expect(page.getByTestId('earlier-days-waiting')).toBeVisible()

  // So follow the mark back to it.
  for (let back = 0; back < 5; back += 1) {
    await page.getByRole('button', { name: 'Previous day' }).click()
  }
  await expect(page.getByTestId('day-waiting')).toContainText('1 arrival waiting for approval')
  // A day this far behind is closed, so settling it costs a reason even from
  // inside the outlet.
  await waiting.first().click()
  await page
    .getByLabel('Why are you approving this?')
    .fill('Worked the morning; I am settling it late')
  await page.getByRole('button', { name: /Approve and record my reason/ }).click()

  // Nothing waiting anywhere now, so every badge is gone rather than showing a
  // nought (design D5), and neither day control points anywhere.
  await expect(nav.getByTestId('nav-badge-attendance-waiting')).toHaveCount(0)
  await expect(page.getByTestId('day-waiting')).toHaveCount(0)
  await expect(page.getByTestId('earlier-days-waiting')).toHaveCount(0)
  await expect(page.getByTestId('later-days-waiting')).toHaveCount(0)
})

test('a manager settles a waiting morning one day at a time, and the list holds still', async ({
  page,
}) => {
  await page.goto('demo/admin/attendance')
  await expect(page.getByTestId('attendance-day')).toBeVisible()
  await expect(page.getByTestId('day-waiting')).toContainText('2 arrivals waiting for approval')

  // No bulk control: one button settling the lot is how an arrival nobody saw
  // gets counted (design D8).
  await expect(page.getByTestId('approve-all')).toHaveCount(0)

  const cards = page.getByTestId(/^day-[0-9a-f-]{36}$/)
  const orderBefore = await cards.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-testid')),
  )

  // The waiting rows are the ones at the top, so the work is where a manager
  // opens (design D12).
  const waiting = page.getByTestId(/^approve-[0-9a-f-]{36}$/)
  await expect(waiting).toHaveCount(2)
  await waiting.first().click()

  // Standing at the counter on the day, so one tap and no sheet.
  await expect(page.getByLabel('Why are you approving this?')).toHaveCount(0)
  await expect(page.getByTestId('day-waiting')).toContainText('1 arrival waiting for approval')
  // Settling one did not move the others out from under the next tap.
  await expect
    .poll(() => cards.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-testid'))))
    .toEqual(orderBefore)

  // And the second is settled on its own, which is the whole point.
  await waiting.first().click()
  // Gone rather than showing a nought: an absent badge always means the same
  // thing (notification-badges, design D5).
  await expect(page.getByTestId('day-waiting')).toHaveCount(0)
})

test('a manager reads one person’s month, and the figures reconcile with the day', async ({
  page,
}) => {
  await page.clock.setFixedTime(MID_MONTH)
  await page.goto('demo/admin/attendance')
  await expect(page.getByTestId('attendance-day')).toBeVisible()

  await page.getByTestId('axis-staff').click()
  await page.getByTestId('person-picker').selectOption('d1000000-0000-4000-a000-000000000004')

  // The pattern, which reading one day at a time cannot show: present days, a
  // late one, days derived as absent, and anything still waiting.
  await expect(page.getByTestId('attendance-tally')).toBeVisible()
  await expect(page.getByTestId('attendance-range')).toBeVisible()
  await expect(page.getByTestId('late-tag').first()).toBeVisible()
  await expect(page.getByTestId('derived-absent').first()).toBeVisible()

  // And any range, not only this month.
  await page.getByRole('button', { name: 'Previous month' }).click()
  await expect(page.getByTestId('range-picker')).toBeVisible()
})

test('a manager records a manual entry, and the row names who typed it in', async ({ page }) => {
  await page.goto('demo/admin/attendance')
  await expect(page.getByTestId('attendance-day')).toBeVisible()

  // Demo Staff has nothing recorded today, so an arrival can still be typed in.
  // 04:00 is the earliest moment of any business day — the one time guaranteed
  // not to be in the future while that day is current.
  const staffId = 'd1000000-0000-4000-a000-000000000004'
  await page.getByTestId(`expand-${staffId}`).click()
  await page.getByTestId(`manual-${staffId}`).click()
  await expect(page.getByText(/permanently show that you entered it/)).toBeVisible()
  await page.getByLabel('When did they arrive?').fill('04:00')
  await page.getByRole('button', { name: 'Record it under my name' }).click()

  const card = page.getByTestId(`day-${staffId}`)
  await expect(card.getByTestId('entered-by')).toContainText('Entered by: Demo Manager')
  // Visibly not a self check-in: the enterer stamp stands where the evidence
  // would be, and no phone or distance chip appears at all.
  await expect(card.getByText('phone')).toHaveCount(0)
  // Recording it settled it: the enterer's stamp is the decision, so nobody has
  // to approve their own typing.
  await expect(card.getByTestId('approval-note')).toContainText('Demo Manager,')
})

test('a seeded manual arrival is visibly not a self check-in, on both sides', async ({ page }) => {
  // The griller's phone died yesterday and the manager typed the arrival in;
  // the day view renders the enterer where the GPS evidence would be.
  await page.goto('demo/admin/attendance')
  await expect(page.getByTestId('attendance-day')).toBeVisible()
  await page.getByRole('button', { name: 'Previous day' }).click()

  const grillerId = 'd1000000-0000-4000-a000-000000000006'
  await page.getByTestId(`expand-${grillerId}`).click()
  const card = page.getByTestId(`day-${grillerId}`)
  await expect(card.getByTestId('entered-by')).toContainText('Entered by: Demo Manager')
  await expect(card.getByText('phone')).toHaveCount(0)
})

test('an employee’s own history shows the approval, where the approver was, and why', async ({
  page,
}) => {
  await page.clock.setFixedTime(MID_MONTH)
  await page.goto('demo/staff/my-attendance')

  const history = page.getByTestId('attendance-history')
  await expect(history).toBeVisible()
  await openEveryDay(page)
  // The same facts a manager sees about the same day — the symmetry the
  // proposal insists on, including the new one: whether the manager was there.
  await expect(history.getByText(/Demo Manager, /).first()).toBeVisible()
  await expect(history.getByText(/Signal drift by the main road/)).toBeVisible()
  await expect(history.getByTestId('late-tag').first()).toBeVisible()
  await expect(history.getByTestId('derived-absent').first()).toBeVisible()
  // And no check-out, anywhere, ever again.
  await expect(history.getByText('Out', { exact: true })).toHaveCount(0)
})

test('a day is a headline until it is opened, and a waiting one is already open', async ({
  page,
}) => {
  await page.goto('demo/admin/attendance')
  await expect(page.getByTestId('attendance-day')).toBeVisible()

  // The runner is waiting for a decision: open, with Approve one tap away. The
  // whole design of this screen is that settling a day is one deliberate act,
  // and a chevron in front of it would be a tap that buys nothing.
  await expect(page.getByTestId(`expand-${DEMO_RUNNER_ACCOUNT_ID}`)).toHaveAttribute(
    'aria-expanded',
    'true',
  )
  await expect(page.getByTestId(`approve-${DEMO_RUNNER_ACCOUNT_ID}`)).toBeVisible()

  // The griller's day is settled, so it is a headline: name, job and verdict,
  // and the evidence only if somebody asks.
  const grillerId = 'd1000000-0000-4000-a000-000000000006'
  const griller = page.getByTestId(`day-${grillerId}`)
  await expect(griller).toContainText('Demo Griller')
  await expect(griller.getByTestId('approval-note')).toHaveCount(0)

  await page.getByTestId(`expand-${grillerId}`).click()
  await expect(griller.getByTestId('approval-note')).toBeVisible()
})

test('the outlet chips carry their own unsettled days, in one row', async ({ page }) => {
  await page.goto('demo/owner/attendance')
  await expect(page.getByTestId('attendance-day')).toBeVisible()

  // One row of outlets, and the count sits on the chip that reaches it — there
  // is no second row of chips saying the same names without the press.
  await expect(page.getByTestId('stranded-days')).toHaveCount(0)
  const kalyani = page.getByTestId(`surface-outlet-${OUTLET_KALYANI_ID}`)
  await expect(kalyani.getByTestId(`outlet-waiting-${OUTLET_KALYANI_ID}`)).toContainText('3')

  // Selecting the other one adds it rather than dropping what is in hand.
  await page.getByTestId(`surface-outlet-${OUTLET_KANCHRAPARA_ID}`).click()
  await expect(kalyani).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId(`surface-outlet-${OUTLET_KANCHRAPARA_ID}`)).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})

test('the by-staff picker is not filtered by the outlet chips', async ({ page }) => {
  await page.clock.setFixedTime(MID_MONTH)
  await page.goto('demo/owner/attendance')
  await expect(page.getByTestId('attendance-day')).toBeVisible()

  // Kalyani alone is selected. The by-staff axis takes its scope from the
  // database rather than from these chips, so Kanchrapara's staff are still
  // offered — filtering them out hid a whole shop's people from a view that is
  // not about shops.
  await expect(page.getByTestId(`surface-outlet-${OUTLET_KANCHRAPARA_ID}`)).toHaveAttribute(
    'aria-pressed',
    'false',
  )
  await page.getByTestId('axis-staff').click()

  const options = await page
    .getByTestId('person-picker')
    .locator('option')
    .evaluateAll((nodes) => nodes.map((node) => (node as HTMLOptionElement).value))
  expect(options).toContain(DEMO_KANCHRAPARA_STAFF_ACCOUNT_ID)

  // And the period is a month, with no second way to say what the period is.
  await expect(page.getByTestId('range-picker')).toBeVisible()
  await expect(page.getByLabel('Range starts')).toHaveCount(0)
  await expect(page.getByLabel('Range ends')).toHaveCount(0)
})

test('the owner sees which outlets have never been surveyed', async ({ page }) => {
  await page.goto('demo/owner/outlets')

  await expect(page.getByTestId('outlet-list')).toBeVisible()
  await expect(page.getByTestId('uncaptured-kanchrapara')).toContainText('never captured on site')
  await expect(page.getByText(/Captured on site/)).toBeVisible()
})

test('the owner captures a position and the outlet stops being unsurveyed', async ({ page }) => {
  await page.goto('demo/owner/outlets')

  const kanchrapara = page
    .getByTestId('outlet-list')
    .locator('> div')
    .filter({ hasText: 'Kanchrapara' })
  await kanchrapara.getByRole('button', { name: /Capture position here/ }).click()

  await page.getByTestId('take-reading').click()
  // The sampling window is ~8s of real time.
  await expect(page.getByTestId('capture-result')).toBeVisible({ timeout: 20_000 })
  await page.getByTestId('save-position').click()

  await expect(page.getByTestId('uncaptured-kanchrapara')).toHaveCount(0)
})

test('the attendance walk makes no request beyond the app origin', async ({ page, baseURL }) => {
  const origin = new URL(baseURL ?? 'http://127.0.0.1:4173/').origin
  const violations: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== origin) violations.push(request.url())
  })

  await openStaffHome(page)
  await page.getByTestId('attendance-action').click()
  await expect(page.getByTestId('attendance-waiting')).toBeVisible()

  await page.goto('demo/staff/my-attendance')
  await expect(page.getByTestId('attendance-history')).toBeVisible()

  await page.goto('demo/admin/attendance')
  await expect(page.getByTestId('attendance-day')).toBeVisible()
  // The approval reads a position too, and it must reach nothing either.
  await page.getByTestId(`approve-${DEMO_RUNNER_ACCOUNT_ID}`).click()
  await expect(page.getByTestId('day-waiting')).toBeVisible()

  await page.goto('demo/admin/people')
  await expect(page.getByText('Demo Griller')).toBeVisible()

  await page.goto('demo/owner/outlets')
  await expect(page.getByTestId('outlet-list')).toBeVisible()

  expect(violations).toEqual([])
})

test('the employee shell offers its attendance surfaces in navigation', async ({ page }) => {
  await page.goto('demo/staff')

  // The shell's own navigation, not the demo role switcher above it.
  const nav = page.getByRole('navigation', { name: 'Primary' })
  await expect(nav.getByRole('link', { name: 'My attendance' })).toBeVisible()
  await expect(nav.getByRole('link', { name: 'Home' })).toBeVisible()
})

/**
 * The gate clause this change exists for, walked rather than asserted: one
 * person, two outlets, one phone, and nothing anywhere asking them which shop
 * they are at.
 */
test('a person assigned to two outlets sees each day named, and picks no outlet', async ({
  page,
}) => {
  // Pinned mid-month for the same reason the other range specs are: the month
  // defaults to the current one and the fixtures are days back from today, so
  // on the 1st the pattern sits in the previous month.
  await page.clock.setFixedTime(MID_MONTH)
  await page.goto('demo/staff/my-attendance')

  // Their own history spans both shops, and each day worked says which — a
  // question that did not exist while a person had one outlet, and cannot be
  // answered from context once they have two. A day nobody recorded names no
  // outlet at all, because it was worked nowhere
  // (attendance-one-day-per-person).
  await expect(page.getByText('Shawarmania Kalyani').first()).toBeVisible()
  await expect(page.getByText('Shawarmania Kanchrapara').first()).toBeVisible()

  // And each business date appears exactly once, rather than once per outlet
  // with half of them absences on days they were at work.
  const dates = await page
    .getByTestId(/^range-day-/)
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-testid')))
  expect(new Set(dates).size).toBe(dates.length)

  await page.goto('demo/staff')
  await expect(page.getByText('Hello, Demo Staff')).toBeVisible()
  // Assigned to both, said plainly on the header rather than hidden behind a
  // control.
  await expect(page.getByText(/Assigned to .*Kalyani.* and .*Kanchrapara/)).toBeVisible()

  // And the one big button is still the only thing to press. No switcher, no
  // outlet select, nothing session-scoped — the fence resolves it (design D5).
  await expect(page.getByTestId('attendance-action')).toBeVisible()
  await expect(page.getByRole('combobox')).toHaveCount(0)
})

/**
 * The owner, at a shop they hold no assignment at
 * (owner-reaches-every-outlet).
 *
 * The whole walk in one test, because it is one gesture in practice: the owner's
 * own navigation carries Attendance, it keeps them in their own shell, the outlet
 * picker offers every shop, the day there can be settled, and the shop they
 * picked is where the next surface opens.
 */
test('the owner settles a day at an outlet they are not assigned to', async ({ page }) => {
  await page.goto('demo/owner')

  // Their own tab, in their own shell. A link into the manager's segment would
  // hand the walk to the manager persona (design D1a).
  // The badge's own label sits inside the link, so the accessible name is
  // "Attendance" plus whatever is waiting.
  await page
    .getByRole('navigation', { name: 'Primary' })
    .first()
    .getByRole('link', { name: /Attendance/ })
    .click()
  await expect(page).toHaveURL(/demo\/owner\/attendance$/)
  await expect(page.getByTestId('attendance-day')).toBeVisible()

  // The selector takes several since attendance-one-day-per-person, so
  // switching outlet is add-the-other then drop-this-one. The last selected
  // outlet cannot be cleared, which is why the order matters.
  await page.getByTestId(`surface-outlet-${OUTLET_KANCHRAPARA_ID}`).click()
  await page.getByTestId(`surface-outlet-${OUTLET_KALYANI_ID}`).click()
  await expect(page.getByText(/Shawarmania Kanchrapara/).first()).toBeVisible()

  // Nobody records the owner's own arrival, so they are not on the roll-call
  // here or anywhere.
  await expect(page.getByTestId(`day-${DEMO_OWNER_ID}`)).toHaveCount(0)

  // One arrival is waiting at this shop, and the owner can settle it — from an
  // emulated position at the *other* outlet, so the rule asks for a reason and
  // records that they were not there.
  await expect(page.getByTestId('day-waiting')).toContainText('1 arrival waiting for approval')
  await page
    .getByTestId(/^approve-[0-9a-f-]{36}$/)
    .first()
    .click()
  await expect(page.getByTestId('reason-required')).toContainText('You are not at the outlet')
  await page.getByLabel('Why are you approving this?').fill('Called the manager, they confirmed it')
  await page.getByRole('button', { name: /Approve and record my reason/ }).click()
  await expect(page.getByTestId('day-waiting')).toHaveCount(0)

  // And the shop they were looking at is the one the next surface opens on
  // (design D6): a reload, then a different surface entirely.
  await page.reload()
  await expect(page.getByTestId(`surface-outlet-${OUTLET_KANCHRAPARA_ID}`)).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.goto('demo/owner/cash')
  await expect(page.getByTestId('surface-outlet')).toHaveValue(OUTLET_KANCHRAPARA_ID)

  // Reaching the surface is not managing the outlet: the drawer stays the
  // manager's, and the screen says so rather than offering a refused control.
  await expect(page.getByTestId('drawer-not-yours')).toBeVisible()
  await expect(page.getByTestId('close-day-button')).toHaveCount(0)
})
