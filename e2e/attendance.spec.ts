import { expect, test, type Page } from '@playwright/test'
import {
  DEMO_HELPER_ACCOUNT_ID,
  DEMO_KANCHRAPARA_STAFF_ACCOUNT_ID,
  DEMO_PREP_COOK_ACCOUNT_ID,
  DEMO_RUNNER_ACCOUNT_ID,
  DEMO_TWO_OUTLETS_ACCOUNT_ID,
} from '../src/data-access/mock/fixtures/accounts'
import { E2E_ORIGIN } from '../ports'
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

/**
 * Selecting a set, and everything about it that depends on where the manager is
 * standing.
 *
 * The position comes from Playwright's own emulation and nothing in the app, so
 * these walks drive the same `navigator.geolocation` path a phone drives. Every
 * one of them asserts both what the sheet said beforehand and what each row
 * recorded afterwards — a summary that reads correctly over rows that stored
 * something else would be the worst outcome available, and only the second half
 * of each assertion rules it out.
 */

/** Add each waiting person to the set, one manual action at a time. */
async function selectEachWaiting(page: Page) {
  // No mode to enter first: the box on each waiting row is the entrance, and the
  // set itself is the mode (design D10).
  await expect(page.getByTestId('selection-bar')).toHaveCount(0)
  const boxes = page.getByTestId(/^select-[0-9a-f-]{36}$/)
  const count = await boxes.count()
  for (let index = 0; index < count; index += 1) await boxes.nth(index).click()
  await expect(page.getByTestId('selection-count')).toContainText(`${count} selected`)
  return count
}

test('a manager at the counter settles a whole selected morning in one action', async ({
  page,
}) => {
  await page.goto('demo/admin/attendance')
  await expect(page.getByTestId('attendance-day')).toBeVisible()
  await expect(page.getByTestId('day-waiting')).toContainText('2 arrivals waiting for approval')

  const chosen = await selectEachWaiting(page)
  expect(chosen).toBe(2)
  await page.getByTestId('approve-selected').click()

  // Standing inside the fence on the day, so nothing is asked except who this
  // is about — and that question is the point of the confirmation.
  await expect(page.getByLabel(/Why are you approving/)).toHaveCount(0)
  await expect(page.getByTestId('confirm-people').getByRole('listitem')).toHaveCount(2)
  await page.getByTestId('confirm-set').click()

  await expect(page.getByTestId('day-waiting')).toHaveCount(0)
  // A successful action empties the set, so the next one starts from nothing.
  await expect(page.getByTestId('selection-bar')).toHaveCount(0)
  await openEveryDay(page)
  const notes = page.getByTestId('approver-place')
  await expect(notes.first()).toContainText('on site')
})

test('a selected set approved from away costs exactly one reason', async ({ page, context }) => {
  await context.setGeolocation(DOWN_THE_ROAD)
  await page.goto('demo/admin/attendance')
  await expect(page.getByTestId('attendance-day')).toBeVisible()

  await selectEachWaiting(page)
  await page.getByTestId('approve-selected').click()

  // One sentence for the set rather than one per person, which is the whole
  // saving this capability offers.
  await expect(page.getByTestId('reason-required')).toContainText('You are not at the outlet')
  await page.getByLabel(/Why are you approving/).fill('Both were at the counter before I left')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByTestId('confirm-people').getByRole('listitem')).toHaveCount(2)
  // The whole of what is about to be written, not only who it is about: the
  // sentence quoted back, and where this action's position reading left it.
  const details = page.getByTestId('confirm-details')
  await expect(details).toContainText('Both were at the counter before I left')
  await expect(details).toContainText('away from the outlet')
  await page.getByTestId('confirm-set').click()

  await expect(page.getByTestId('day-waiting')).toHaveCount(0)
  await openEveryDay(page)
  // Recorded on both rows the action settled, and both say the approver was not
  // there. Asserted on those two rows by name: the day also carries arrivals
  // settled long before this action, and a sweep over every approval chip on
  // screen would be asserting about those instead.
  for (const person of [DEMO_RUNNER_ACCOUNT_ID, DEMO_PREP_COOK_ACCOUNT_ID]) {
    const card = page.getByTestId(`day-${person}`)
    await expect(card.getByTestId('approval-note')).toContainText(
      'Both were at the counter before I left',
    )
    await expect(card.getByTestId('approver-place')).not.toContainText('on site')
  }
})

test('one reading inside one fence partitions a set spanning two outlets', async ({ page }) => {
  // The owner is the caller because only they reach both shops, and the
  // emulated position is Kalyani's counter throughout.
  await page.goto('demo/owner/attendance')
  await expect(page.getByTestId('attendance-day')).toBeVisible()
  await page.getByTestId(`surface-outlet-${OUTLET_KANCHRAPARA_ID}`).click()
  await expect(page.getByTestId('attendance-day')).toBeVisible()

  await selectEachWaiting(page)
  await page.getByTestId('approve-selected').click()

  // Judged per row against that row's own outlet. One reading measured against
  // two fixed points is arithmetic, not a claim to have stood at both.
  const partition = page.getByTestId('approval-partition')
  await expect(partition).toContainText(/Approved normally: .*Kalyani/)
  await expect(partition).toContainText(/Need your reason: .*Kanchrapara/)
  await expect(partition).toContainText('recorded only against the')

  await page.getByLabel(/Why are you approving/).fill('Kanchrapara confirmed on the shift photo')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByTestId('confirm-set').click()
  await expect(page.getByTestId('day-waiting')).toHaveCount(0)

  await openEveryDay(page)
  // The reason reached the far outlet's row and no other, and each row carries
  // its own computed distance rather than a shared verdict.
  const kanchrapara = page.getByTestId(`day-${DEMO_KANCHRAPARA_STAFF_ACCOUNT_ID}`)
  await expect(kanchrapara.getByTestId('approval-note')).toContainText(
    'Kanchrapara confirmed on the shift photo',
  )
  const runner = page.getByTestId(`day-${DEMO_RUNNER_ACCOUNT_ID}`)
  await expect(runner.getByTestId('approval-note')).not.toContainText('shift photo')
  await expect(runner.getByTestId('approver-place')).toContainText('on site')
  await expect(kanchrapara.getByTestId('approver-place')).not.toContainText('on site')
})

test('a set approved with no position at all costs a reason and records nothing it cannot', async ({
  page,
  context,
}) => {
  // No emulated position: the device is asked and answers nothing, which is the
  // same code path a phone indoors takes.
  await context.setGeolocation(null)
  await page.goto('demo/admin/attendance')
  await expect(page.getByTestId('attendance-day')).toBeVisible()

  await selectEachWaiting(page)
  await page.getByTestId('approve-selected').click()

  await expect(page.getByTestId('reason-required')).toContainText('Your position could not be read')
  await page.getByLabel(/Why are you approving/).fill('Phone could not find a position')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByTestId('confirm-set').click()
  await expect(page.getByTestId('day-waiting')).toHaveCount(0)

  await openEveryDay(page)
  // Unknown, and said so. A row claiming a distance here would be claiming a
  // place nobody read.
  for (const person of [DEMO_RUNNER_ACCOUNT_ID, DEMO_PREP_COOK_ACCOUNT_ID]) {
    await expect(page.getByTestId(`day-${person}`).getByTestId('approver-place')).toContainText(
      'position not recorded',
    )
  }
})

test('a denied set shares one reason and one retry choice, and reads no position', async ({
  page,
}) => {
  await page.goto('demo/admin/attendance')
  await expect(page.getByTestId('attendance-day')).toBeVisible()

  await selectEachWaiting(page)
  await page.getByTestId('deny-selected').click()

  await expect(page.getByTestId('denial-shared')).toContainText('apply to all 2 of them')
  // The control names a business date rather than saying `today`, because a set
  // can reach back over days that have already closed.
  await expect(page.getByText(/Prevent another check-in on/)).toBeVisible()
  await page.getByLabel('Reason').fill('Neither was on the rota')
  await page.getByTestId('prevent-retry').check()
  await page.getByRole('button', { name: 'Continue' }).click()
  // Both inputs read back before the write, so the last screen is the whole of
  // what the decision will say — said once, in two words.
  await expect(page.getByTestId('confirm-details')).toContainText('Neither was on the rota')
  await expect(page.getByTestId('confirm-details')).toContainText('not allowed')
  await expect(page.getByTestId('confirm-note')).toHaveCount(0)
  await page.getByTestId('confirm-set').click()

  await expect(page.getByTestId('day-waiting')).toHaveCount(0)
  await openEveryDay(page)
  // Denial vouches for nobody's whereabouts, so neither denied row carries an
  // approval or a position at all.
  for (const person of [DEMO_RUNNER_ACCOUNT_ID, DEMO_PREP_COOK_ACCOUNT_ID]) {
    const card = page.getByTestId(`day-${person}`)
    await expect(card.getByTestId('approver-place')).toHaveCount(0)
    await expect(card.getByTestId('approval-note')).toHaveCount(0)
    await expect(card).toContainText('Neither was on the rota')
  }
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

  // No control that adds more than one person to a set, by any name: a single
  // button settling the lot is how an arrival nobody saw gets counted.
  await expect(page.getByTestId('approve-all')).toHaveCount(0)
  await expect(page.getByTestId('select-all')).toHaveCount(0)
  await expect(page.getByTestId('toggle-selecting')).toHaveCount(0)
  await page
    .getByTestId(/^select-[0-9a-f-]{36}$/)
    .first()
    .click()
  for (const name of [/approve all/i, /select all/i, /select the rest/i, /select everyone/i]) {
    await expect(page.getByRole('button', { name })).toHaveCount(0)
  }
  // Clear only ever takes people out of an action, and emptying the set leaves
  // selection, which puts the per-row buttons back.
  await page.getByTestId('clear-selection').click()
  await expect(page.getByTestId('selection-bar')).toHaveCount(0)

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

test('a manager records a historical manual entry through today’s same process', async ({
  page,
  baseURL,
}) => {
  const origin = new URL(baseURL ?? E2E_ORIGIN).origin
  const unexpectedRequests: string[] = []
  const consoleErrors: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== origin) unexpectedRequests.push(request.url())
  })
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  await page.goto('demo/admin/attendance')
  await expect(page.getByTestId('attendance-day')).toBeVisible()
  await page.getByRole('button', { name: 'Previous day' }).click()
  const businessDateLabel = await page.getByTestId('day-label').textContent()

  // Demo Helper has nothing recorded on the prior day. The same button and
  // time-only manager testimony used today must remain available there.
  const staffId = DEMO_HELPER_ACCOUNT_ID
  await page.getByTestId(`expand-${staffId}`).click()
  await expect(page.getByTestId(`manual-${staffId}`)).toHaveText('Record arrival')
  await page.getByTestId(`manual-${staffId}`).click()
  await expect(page.getByRole('heading', { name: 'Record an arrival' })).toBeVisible()
  await expect(page.getByText(new RegExp(`on ${businessDateLabel}`))).toBeVisible()
  await expect(page.getByText(/permanently show that you entered it/)).toBeVisible()
  await page.getByLabel('When did they arrive?').fill('09:00')
  await page.getByRole('button', { name: 'Record it under my name' }).click()

  const card = page.getByTestId(`day-${staffId}`)
  await expect(card.getByTestId('entered-by')).toContainText('Entered by: Demo Manager')
  // Visibly not a self check-in: the enterer stamp stands where the evidence
  // would be, and no phone or distance chip appears at all.
  await expect(card.getByText('phone')).toHaveCount(0)
  // Recording it settled it: the enterer's stamp is the decision, so nobody has
  // to approve their own typing.
  await expect(card.getByTestId('approval-note')).toContainText('Demo Manager,')
  expect(unexpectedRequests).toEqual([])
  expect(consoleErrors).toEqual([])
})

test('a manager records a manual entry on the current business day', async ({ page }) => {
  // The historical case above and this one are the SAME action on two dates,
  // and that is exactly why both are here: the day view no longer gates the
  // button on the date, so the case that used to be the only one has to keep
  // proving today still works rather than being replaced by its own extension.
  await page.goto('demo/admin/attendance')
  await expect(page.getByTestId('attendance-day')).toBeVisible()
  await expect(page.getByTestId('day-label')).toHaveText('Today')

  // Demo Staff has nothing recorded today, so an arrival can still be typed in.
  // 04:00 is the earliest moment of any business day — the one time guaranteed
  // neither to be in the future nor to fall on the day before, which the
  // command now refuses as an instant outside the date it names.
  const staffId = 'd1000000-0000-4000-a000-000000000004'
  await page.getByTestId(`expand-${staffId}`).click()
  await page.getByTestId(`manual-${staffId}`).click()
  await expect(page.getByText(/permanently show that you entered it/)).toBeVisible()
  await page.getByLabel('When did they arrive?').fill('04:00')
  await page.getByRole('button', { name: 'Record it under my name' }).click()

  const card = page.getByTestId(`day-${staffId}`)
  await expect(card.getByTestId('entered-by')).toContainText('Entered by: Demo Manager')
  await expect(card.getByText('phone')).toHaveCount(0)
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

test('a settled historical arrival time changes through an attributed correction', async ({
  page,
}) => {
  await page.goto('demo/admin/attendance')
  await expect(page.getByTestId('attendance-day')).toBeVisible()

  // Waiting evidence is still evidence under review, so the correction entry
  // remains absent until the manager first settles it.
  await expect(page.getByTestId(`correct-${DEMO_RUNNER_ACCOUNT_ID}`)).toHaveCount(0)

  await page.getByRole('button', { name: 'Previous day' }).click()
  const grillerId = 'd1000000-0000-4000-a000-000000000006'
  await page.getByTestId(`expand-${grillerId}`).click()
  await page.getByTestId(`correct-${grillerId}`).click()
  await page.getByLabel('Correction').selectOption('time')

  const save = page.getByRole('button', { name: 'Save correction' })
  await page.getByLabel('Reason').fill('Paper register confirms the later arrival')
  await expect(save).toBeDisabled()
  await page.getByLabel('Corrected check-in time').fill('14:30')
  await save.click()

  const card = page.getByTestId(`day-${grillerId}`)
  await expect(card.getByTestId('late-tag')).toBeVisible()
  const history = card.getByTestId('attendance-history-sequence')
  await expect(history).toContainText('Changed check-in time from')
  await expect(history).toContainText('to 02:30 pm by Demo Manager')
  await expect(history).toContainText('Paper register confirms the later arrival')
  // The original manual event remains in the same sequence rather than being
  // rewritten into a second fabricated arrival.
  await expect(history.getByText(/Checked in at Shawarmania Kalyani/)).toHaveCount(1)

  // A second correction proves lateness is derived from the effective time in
  // both directions, while keeping every earlier correction in the audit trail.
  await page.getByTestId(`correct-${grillerId}`).click()
  await page.getByLabel('Correction').selectOption('time')
  await page.getByLabel('Corrected check-in time').fill('12:30')
  await page.getByLabel('Reason').fill('Owner verified the earlier arrival')
  await page.getByRole('button', { name: 'Save correction' }).click()
  await expect(card.getByTestId('late-tag')).toHaveCount(0)
  await expect(history).toContainText('from 02:30 pm to 12:30 pm by Demo Manager')
  await expect(history).toContainText('Owner verified the earlier arrival')
  await expect(history.getByText(/Checked in at Shawarmania Kalyani/)).toHaveCount(1)
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
  await expect(history.getByText(/Signal drift by the main road/).first()).toBeVisible()
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

test('a waiting row cannot be closed, and the set takes the day picker\u2019s place', async ({
  page,
}) => {
  await page.goto('demo/admin/attendance')
  await expect(page.getByTestId('attendance-day')).toBeVisible()

  // Every control that decides this row lives in its panel, so a closed waiting
  // row is one a manager can neither act on nor tell apart from one already in
  // the set. The chevron stays rendered and goes inert, so nothing shifts
  // sideways when the row settles and it becomes live again (design D10).
  const chevron = page.getByTestId(`expand-${DEMO_RUNNER_ACCOUNT_ID}`)
  await expect(chevron).toBeDisabled()
  await expect(chevron).toHaveAttribute('aria-expanded', 'true')

  // The set's bar replaces the day picker rather than appearing under the list,
  // so pressing the first box moves no row out from under the thumb that
  // pressed it, and the day cannot be changed while a set is open.
  await expect(page.getByTestId('day-label')).toBeVisible()
  await page.getByTestId(`select-${DEMO_RUNNER_ACCOUNT_ID}`).click()
  await expect(page.getByTestId('selection-count')).toContainText('1 selected')
  await expect(page.getByTestId('day-label')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Previous day' })).toHaveCount(0)
  // And the row's own Approve and Deny stand down while the set's own actions
  // are the ones on offer.
  await expect(page.getByTestId(`approve-${DEMO_RUNNER_ACCOUNT_ID}`)).toHaveCount(0)
  await expect(page.getByTestId(`deny-${DEMO_RUNNER_ACCOUNT_ID}`)).toHaveCount(0)

  // Taking the last person out leaves selection by itself, and everything the
  // bar displaced comes back.
  await page.getByTestId(`select-${DEMO_RUNNER_ACCOUNT_ID}`).click()
  await expect(page.getByTestId('selection-bar')).toHaveCount(0)
  await expect(page.getByTestId('day-label')).toBeVisible()
  await expect(page.getByTestId(`approve-${DEMO_RUNNER_ACCOUNT_ID}`)).toBeVisible()
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

test('the by-staff picker follows the outlet chips', async ({ page }) => {
  await page.clock.setFixedTime(MID_MONTH)
  await page.goto('demo/owner/attendance')
  await expect(page.getByTestId('attendance-day')).toBeVisible()

  // One scope above both axes, in the header, where the Ledger keeps its own.
  // It stays put across the switch, because a control that appears and
  // disappears under the title is one whose meaning the reader has to keep
  // re-deciding.
  const kanchrapara = page.getByTestId(`surface-outlet-${OUTLET_KANCHRAPARA_ID}`)
  await expect(kanchrapara).toHaveAttribute('aria-pressed', 'false')
  await page.getByTestId('axis-staff').click()
  await expect(page.getByTestId('surface-outlets')).toBeVisible()

  const offered = () =>
    page
      .getByTestId('person-picker')
      .locator('option')
      .evaluateAll((nodes) => nodes.map((node) => (node as HTMLOptionElement).value))

  // Kalyani alone is selected, so a Kanchrapara-only person is not offered —
  // and one tap brings them back, which is the whole cost of the narrowing.
  expect(await offered()).not.toContain(DEMO_KANCHRAPARA_STAFF_ACCOUNT_ID)
  await kanchrapara.click()
  await expect
    .poll(offered, { message: 'Kanchrapara staff offered once their outlet is on' })
    .toContain(DEMO_KANCHRAPARA_STAFF_ACCOUNT_ID)

  // What the chips must NOT narrow: the month itself. Somebody staffed at both
  // shops still reads as one continuous month with Kalyani alone selected,
  // because the read names no outlet at all.
  await kanchrapara.click()
  await expect(kanchrapara).toHaveAttribute('aria-pressed', 'false')
  await page.getByTestId('person-picker').selectOption(DEMO_TWO_OUTLETS_ACCOUNT_ID)
  await expect(page.getByTestId('attendance-range')).toBeVisible()
  await expect(
    page.getByTestId('attendance-range').getByText('Shawarmania Kanchrapara').first(),
  ).toBeVisible()

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
  const origin = new URL(baseURL ?? E2E_ORIGIN).origin
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
  // Denial and its retry-policy correction stay entirely in the demo store too.
  await page.getByTestId(`deny-${DEMO_RUNNER_ACCOUNT_ID}`).click()
  await expect(page.getByTestId('prevent-retry')).not.toBeChecked()
  await page.getByTestId('prevent-retry').check()
  await page.getByRole('button', { name: 'Deny check-in' }).click()
  await page.getByTestId(`correct-${DEMO_RUNNER_ACCOUNT_ID}`).click()
  await page.getByLabel('Correction').selectOption('allow_retry')
  await page.getByLabel('Reason').fill('Employee should check in at the assigned outlet')
  await page.getByRole('button', { name: 'Save correction' }).click()
  await expect(page.getByText('Allowed another check-in')).toBeVisible()

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
  await page.goto('demo/owner/drawer')
  // The same chip, on a surface that reads one outlet rather than several: the
  // switcher is one control in two modes, so the remembered choice reads the same
  // way on both.
  await expect(page.getByTestId(`surface-outlet-${OUTLET_KANCHRAPARA_ID}`)).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  // **And here the rule reverses, deliberately.** This test used to assert that
  // reaching the surface conferred nothing — that the drawer stayed the
  // manager's and the owner was offered no control.
  // `cash-is-counted-not-closed` (#11) settled that question the other way: the
  // person who counts the cash at these outlets IS the owner, and both Super
  // Admins had their Franchise Admin rows deleted on 2026-08-01, so the old rule
  // left nobody able to count a drawer anywhere.
  //
  // What it costs is evidence rather than prohibition: the count asks where they
  // were standing, and stores the answer.
  await expect(page.getByTestId('open-count')).toBeVisible()
  await page.getByTestId('open-count').click()
  await expect(page.getByTestId('away-reason')).toBeVisible()
  await expect(page.getByText(/nothing is refused for being elsewhere/i)).toBeVisible()
})
