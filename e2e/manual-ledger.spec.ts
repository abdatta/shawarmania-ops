import { expect, test } from '@playwright/test'

/**
 * The manual ledger (#36) — **temporary, and this spec goes with it.**
 *
 * baseURL carries the deployment sub-path, so every goto here is relative.
 *
 * The claims this file exists to gate are the ones a component test cannot make
 * against a real build: the surface is in the owner's navigation and in nobody
 * else's, its path renders nothing for the other three roles, a full trading day
 * can be recorded and read on a phone-sized screen, a recorded day collapses to a
 * reading whose figures come back unchanged on Edit, and a retrospective
 * commission edit moves the month without moving the drawer.
 */

const OTHER_ROLES = [
  { segment: 'admin', label: 'Admin' },
  { segment: 'biller', label: 'Biller' },
  { segment: 'staff', label: 'Staff' },
] as const

test('the owner records a full trading day on a phone and reads its difference', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('demo/owner/ledger')

  await expect(page.getByRole('heading', { name: 'Ledger' })).toBeVisible()
  await expect(page.getByTestId('ledger-day-form')).toBeVisible()

  // Opening cash and both rates arrive inherited from the previous recorded day,
  // so a nightly entry is four channels and a count rather than seven fields.
  await expect(page.getByTestId('opening-cash')).not.toHaveValue('')
  await expect(page.getByTestId('zomato-commission')).not.toHaveValue('')

  const opening = Number(await page.getByTestId('opening-cash').inputValue())

  await page.getByTestId('cash-revenue').fill('12000')
  await page.getByTestId('upi-revenue').fill('4000')
  await page.getByTestId('zomato-revenue').fill('3000')
  await page.getByTestId('swiggy-revenue').fill('2500')

  // Each aggregator's block says what actually arrives, beside the rate that
  // decided it, before anything is saved.
  await expect(page.getByTestId('zomato-revenue-net')).not.toHaveText('—')
  await expect(page.getByTestId('aggregator-swiggy')).toContainText('Actually received')

  // The rules are one tap away rather than filling the form: the whole entry card
  // has to fit a phone, which is the only device this gets typed on.
  await expect(page.getByText(/genuinely lighter/i)).toHaveCount(0)
  await page.getByTestId('hint-drawer').click()
  await expect(page.getByTestId('hint-drawer-panel')).toContainText('genuinely lighter')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('hint-drawer-panel')).toHaveCount(0)

  // An expense, with what it was for — required, and the reason the ledger is
  // worth keeping.
  await page.getByTestId('add-ledger-expense').click()
  await page.getByTestId('expense-amount').fill('2400')
  await page.getByTestId('expense-description').fill('Chicken, 10 kg, from Nadia Poultry')
  await page.getByRole('button', { name: 'Record expense' }).click()
  await expect(page.getByTestId('ledger-expense-list')).toContainText('Nadia Poultry')

  // Cash out with its reason: this is how equipment bought from the drawer is
  // recorded, and it is what keeps the count reconciling while the month's
  // expenses stay clean.
  await page.getByTestId('cash-removed').fill('4000')
  await page.getByTestId('cash-removed-reason').fill('Banked on the way home')

  // opening + 12,000 − 2,400 − 4,000
  const expected = opening + 12_000 - 2_400 - 4_000
  await page.getByTestId('counted-cash').fill(String(expected))
  await expect(page.getByTestId('day-difference')).toHaveAttribute('data-difference', 'balanced')

  // And short, in words, when the drawer is light.
  await page.getByTestId('counted-cash').fill(String(expected - 250))
  await expect(page.getByTestId('day-difference')).toHaveAttribute('data-difference', 'short')
  await expect(page.getByTestId('day-difference')).toContainText('missing from the drawer')

  await page.getByTestId('day-note').fill('Counted twice')
  await page.getByTestId('save-day').click()
  await expect(page.getByTestId('day-saved')).toBeVisible()

  // Recorded, so the twelve inputs give way to a reading and the two answers the
  // surface exists for are what is left on a 390px screen.
  await expect(page.getByTestId('ledger-day-recorded')).toBeVisible()
  await expect(page.getByTestId('ledger-day-form')).toHaveCount(0)
  await expect(page.getByTestId('counted-cash')).toHaveCount(0)
  // The revenue side, with the rate each aggregator was netted at.
  await expect(page.getByTestId('recorded-revenue-net')).toBeVisible()
  await expect(page.getByTestId('ledger-day-recorded')).toContainText('Less commission at')
  // The drawer still reads below it, and the reason for the cash that left is
  // beside the figure it explains.
  await expect(page.getByTestId('day-difference')).toContainText('missing from the drawer')
  await expect(page.getByTestId('day-reading')).toContainText('Banked on the way home')

  // And the figures come back exactly as they were stored.
  await page.getByTestId('edit-day').click()
  await expect(page.getByTestId('counted-cash')).toHaveValue(String(expected - 250))
  await expect(page.getByTestId('cash-revenue')).toHaveValue('12000')

  // Cancelling puts the reading back and writes nothing.
  await page.getByTestId('cash-revenue').fill('1')
  await page.getByTestId('cancel-day-edit').click()
  await expect(page.getByTestId('ledger-day-recorded')).toBeVisible()
  await expect(page.getByTestId('recorded-cash')).toContainText('12,000')
})

test('the month names its basis and nets the aggregators per day', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('demo/owner/ledger')
  await expect(page.getByTestId('ledger-day-form')).toBeVisible()

  await page.getByTestId('ledger-view-month').click()

  await expect(page.getByTestId('month-profit-figure')).toBeVisible()
  await expect(page.getByTestId('month-profit-basis')).toContainText(
    'Cash basis operating estimate',
  )
  await expect(page.getByTestId('month-profit')).toContainText('not a full account of money out')

  // Commission comes off revenue, and the expenses card says so rather than
  // leaving the reader to wonder whether it was counted twice.
  await expect(page.getByTestId('month-zomato-commission')).toBeVisible()
  await expect(page.getByTestId('month-expenses')).toContainText(
    'already taken off the revenue above',
  )
  // No category is an aggregator: the shared enum has no such value, and this is
  // what that absence looks like on screen.
  await expect(page.locator('[data-testid^="month-category-"]')).not.toHaveCount(0)
  for (const forbidden of ['month-category-zomato', 'month-category-swiggy']) {
    await expect(page.locator(`[data-testid="${forbidden}"]`)).toHaveCount(0)
  }
})

test('recording a day at each outlet keeps the two apart', async ({ page }) => {
  await page.goto('demo/owner/ledger')
  await expect(page.getByTestId('ledger-day-form')).toBeVisible()

  await page.getByTestId('cash-revenue').fill('12000')
  const kalyaniOpening = await page.getByTestId('opening-cash').inputValue()

  // One chip per outlet, and the chosen one is disabled rather than clearable.
  await page.getByRole('button', { name: 'Shawarmania Kanchrapara' }).click()
  await expect(page.getByRole('button', { name: 'Shawarmania Kanchrapara' })).toBeDisabled()
  await expect(page.getByTestId('ledger-day-form')).toBeVisible()

  // A different outlet is a different day row, and the first one at Kanchrapara
  // inherits nothing at all.
  await expect(page.getByTestId('cash-revenue')).toHaveValue('')
  await expect(page.getByTestId('opening-cash')).toHaveValue('')
  expect(kalyaniOpening).not.toBe('')
  await expect(page.getByText(/first day at this outlet/i)).toBeVisible()
})

test('a retrospective commission edit moves the month and not the drawer', async ({ page }) => {
  await page.goto('demo/owner/ledger')
  await expect(page.getByTestId('ledger-day-form')).toBeVisible()

  // A recorded day with aggregator revenue on it: the day before today, reached
  // the way the owner reaches it — one step back.
  await expect(page.getByTestId('ledger-day-open')).toHaveText('Today')
  await page.getByTestId('ledger-step-back').click()
  await expect(page.getByTestId('ledger-day-open')).not.toHaveText('Today')
  await expect(page.getByTestId('ledger-day-state')).toContainText('Recorded')

  const expectedBefore = await page.getByTestId('expected-cash').textContent()

  await page.getByTestId('ledger-view-month').click()
  const profitBefore = await page.getByTestId('month-profit-figure').textContent()

  // Back to the same day: the chosen date survives a look at the month, so
  // stepping again here would silently correct the day before the one measured.
  await page.getByTestId('ledger-view-day').click()
  await expect(page.getByTestId('expected-cash')).toHaveText(expectedBefore ?? '')

  // A recorded day opens as a reading, so correcting it is a deliberate act.
  await page.getByTestId('edit-day').click()
  await page.getByTestId('zomato-commission').fill('30')
  await page.getByTestId('save-day').click()
  await expect(page.getByTestId('day-saved')).toBeVisible()

  // The drawer is untouched: commission is not cash, and never was.
  await expect(page.getByTestId('expected-cash')).toHaveText(expectedBefore ?? '')

  await page.getByTestId('ledger-view-month').click()
  await expect(page.getByTestId('month-profit-figure')).not.toHaveText(profitBefore ?? '')
})

test('the ledger is in the owner’s navigation and in nobody else’s', async ({ page }) => {
  await page.goto('demo/owner')
  await expect(page.getByRole('link', { name: 'Ledger' })).toBeVisible()

  for (const role of OTHER_ROLES) {
    await page.goto(`demo/${role.segment}`)
    await expect(page.getByRole('link', { name: 'Ledger' }), role.segment).toHaveCount(0)
  }
})

for (const role of OTHER_ROLES) {
  test(`the manual-ledger path renders nothing for a ${role.label}`, async ({ page }) => {
    await page.goto(`demo/${role.segment}/ledger`)

    // Absent rather than forbidden: no manual-ledger surface is declared for this
    // role, so the route lands on the shell's own not-found — the same treatment
    // any other undeclared path gets.
    await expect(page.getByText('That page does not exist')).toBeVisible()
    await expect(page.getByTestId('ledger-day-form')).toHaveCount(0)
    // Still inside the demo, so the banner still stands.
    await expect(page.getByTestId('demo-banner')).toBeVisible()
  })
}
