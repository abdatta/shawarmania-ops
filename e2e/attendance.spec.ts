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

test('an employee checks in at the counter and checks out again', async ({ page }) => {
  await openStaffHome(page)

  const action = page.getByTestId('attendance-action')
  await expect(action).toHaveText(/Check in/)
  await action.click()

  await expect(page.getByTestId('attendance-action')).toHaveText(/Check out/)
  await expect(page.getByText(/from the outlet/)).toBeVisible()
  await expect(page.getByTestId('attendance-blocked')).toHaveCount(0)

  await page.getByTestId('attendance-action').click()
  await expect(page.getByTestId('attendance-complete')).toContainText('Your day is recorded')
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
  await expect(blocked).toContainText('too far from the outlet')
  // The numbers a person needs to argue with it: distance, limit, and how
  // sure the phone was.
  await expect(blocked).toContainText('150 m')
  await expect(blocked).toContainText(/±\d+/)

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

test('a manager sees the outlet day, approves an override, and the reason sticks', async ({
  page,
}) => {
  await page.goto('demo/admin/attendance')

  const day = page.getByTestId('attendance-day')
  await expect(day).toBeVisible()
  await expect(page.getByTestId('awaiting-count')).toContainText('waiting for your decision')

  await page.getByTestId(`approve-${DEMO_RUNNER_ACCOUNT_ID}`).click()
  await page.getByLabel('Why are you approving this?').fill('At the counter, phone signal poor')
  await page.getByRole('button', { name: /Approve and record my reason/ }).click()

  await expect(page.getByTestId('awaiting-count')).toHaveCount(0)
  await expect(page.getByText(/Approved by Demo Manager/)).toBeVisible()
  await expect(page.getByText(/At the counter, phone signal poor/)).toBeVisible()
})

test('a manager records a manual entry, and the row names who typed it in', async ({ page }) => {
  await page.goto('demo/admin/attendance')
  await expect(page.getByTestId('attendance-day')).toBeVisible()

  // Demo Staff has nothing recorded today, so the offered event is a
  // check-in. 04:00 is the earliest moment of any business day — the one
  // time guaranteed not to be in the future while that day is current.
  const staffId = 'd1000000-0000-4000-a000-000000000004'
  await page.getByTestId(`manual-${staffId}`).click()
  await expect(page.getByText(/permanently show that you entered it/)).toBeVisible()
  await page.getByLabel('When did it happen?').fill('04:00')
  await page.getByRole('button', { name: 'Record it under my name' }).click()

  const card = page.getByTestId(`day-${staffId}`)
  await expect(card.getByTestId('entered-by')).toContainText('Entered by Demo Manager')
  await expect(card.getByText('manual entry')).toBeVisible()
})

test('a seeded manual check-out is visibly not a self check-in, on both sides', async ({
  page,
}) => {
  // The griller's phone died yesterday and the manager typed the check-out
  // in; the day view renders the enterer where the GPS evidence would be.
  await page.goto('demo/admin/attendance')
  await expect(page.getByTestId('attendance-day')).toBeVisible()
  await page.getByRole('button', { name: 'Previous day' }).click()

  const grillerId = 'd1000000-0000-4000-a000-000000000006'
  const card = page.getByTestId(`day-${grillerId}`)
  await expect(card.getByTestId('entered-by')).toContainText('Entered by Demo Manager')
  await expect(card.getByText('manual entry')).toBeVisible()
})

test('an employee’s own history shows the override and its reason', async ({ page }) => {
  await page.goto('demo/staff/my-attendance')

  const history = page.getByTestId('attendance-history')
  await expect(history).toBeVisible()
  // The same facts a manager sees about the same day — the symmetry the
  // proposal insists on.
  await expect(history.getByText(/Approved by Demo Manager/)).toBeVisible()
  await expect(history.getByText(/Signal drift by the main road/)).toBeVisible()
  await expect(history.getByText('check-out flagged')).toBeVisible()
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
  await expect(page.getByTestId('attendance-action')).toHaveText(/Check out/)

  await page.goto('demo/staff/my-attendance')
  await expect(page.getByTestId('attendance-history')).toBeVisible()

  await page.goto('demo/admin/attendance')
  await expect(page.getByTestId('attendance-day')).toBeVisible()

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
