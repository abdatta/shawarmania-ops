import { expect, test, type Page } from '@playwright/test'
import { DEMO_RUNNER_ACCOUNT_ID } from '../src/data-access/mock/fixtures/accounts'

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
  await expect(page.getByTestId('awaiting-count')).toContainText('waiting for your approval')

  // The browser's emulated position is AT_COUNTER, and the day being settled is
  // today's — so the honest path is exactly one tap, with no sheet at all.
  await page.getByTestId(`approve-${DEMO_RUNNER_ACCOUNT_ID}`).click()

  const card = page.getByTestId(`day-${DEMO_RUNNER_ACCOUNT_ID}`)
  await expect(card.getByTestId('approval-note')).toContainText('Approved by Demo Manager')
  await expect(card.getByTestId('approver-place')).toContainText('They were at the outlet')
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
  await expect(card.getByTestId('approver-place')).toContainText('from the outlet')
})

test('a manager settles a waiting morning one day at a time, and the list holds still', async ({
  page,
}) => {
  await page.goto('demo/admin/attendance')
  await expect(page.getByTestId('attendance-day')).toBeVisible()
  await expect(page.getByTestId('awaiting-count')).toBeVisible()

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
  await expect(page.getByTestId('awaiting-count')).toContainText('1 arrival is waiting')
  // Settling one did not move the others out from under the next tap.
  await expect
    .poll(() => cards.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-testid'))))
    .toEqual(orderBefore)

  // And the second is settled on its own, which is the whole point.
  await waiting.first().click()
  await expect(page.getByTestId('awaiting-count')).toHaveCount(0)
})

test('a manager reads one person’s month, and the figures reconcile with the day', async ({
  page,
}) => {
  await page.goto('demo/admin/attendance')
  await expect(page.getByTestId('attendance-day')).toBeVisible()

  await page.getByTestId('axis-person').click()
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
  await page.getByTestId(`manual-${staffId}`).click()
  await expect(page.getByText(/permanently show that you entered it/)).toBeVisible()
  await page.getByLabel('When did they arrive?').fill('04:00')
  await page.getByRole('button', { name: 'Record it under my name' }).click()

  const card = page.getByTestId(`day-${staffId}`)
  await expect(card.getByTestId('entered-by')).toContainText('Entered by Demo Manager')
  await expect(card.getByText('manual entry')).toBeVisible()
  // Recording it settled it: the enterer's stamp is the decision, so nobody has
  // to approve their own typing.
  await expect(card.getByTestId('approval-note')).toContainText('Approved by Demo Manager')
})

test('a seeded manual arrival is visibly not a self check-in, on both sides', async ({ page }) => {
  // The griller's phone died yesterday and the manager typed the arrival in;
  // the day view renders the enterer where the GPS evidence would be.
  await page.goto('demo/admin/attendance')
  await expect(page.getByTestId('attendance-day')).toBeVisible()
  await page.getByRole('button', { name: 'Previous day' }).click()

  const grillerId = 'd1000000-0000-4000-a000-000000000006'
  const card = page.getByTestId(`day-${grillerId}`)
  await expect(card.getByTestId('entered-by')).toContainText('Entered by Demo Manager')
  await expect(card.getByText('manual entry')).toBeVisible()
})

test('an employee’s own history shows the approval, where the approver was, and why', async ({
  page,
}) => {
  await page.goto('demo/staff/my-attendance')

  const history = page.getByTestId('attendance-history')
  await expect(history).toBeVisible()
  // The same facts a manager sees about the same day — the symmetry the
  // proposal insists on, including the new one: whether the manager was there.
  await expect(history.getByText(/Approved by Demo Manager/).first()).toBeVisible()
  await expect(history.getByText(/Signal drift by the main road/)).toBeVisible()
  await expect(history.getByTestId('late-tag').first()).toBeVisible()
  await expect(history.getByTestId('derived-absent').first()).toBeVisible()
  // And no check-out, anywhere, ever again.
  await expect(history.getByText('Out', { exact: true })).toHaveCount(0)
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
  await expect(page.getByTestId('awaiting-count')).toBeVisible()

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
  await page.goto('demo/staff/my-attendance')

  // Their own history spans both shops, and each day says which — a question
  // that did not exist while a person had one outlet, and cannot be answered
  // from context once they have two.
  await expect(page.getByText('Shawarmania Kalyani').first()).toBeVisible()
  await expect(page.getByText('Shawarmania Kanchrapara').first()).toBeVisible()

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
