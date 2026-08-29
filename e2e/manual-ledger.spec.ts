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

// Outlet staff only. `the-ledger-opens-to-the-outlet` gave the manager the
// ledger at the outlets they are assigned to, so the Admin's case is asserted
// below as reachable rather than here as absent.
const STAFF_ROLES = [
  { segment: 'biller', label: 'Biller' },
  { segment: 'staff', label: 'Staff' },
] as const

test('the owner records a full trading day on a phone and reads its difference', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('demo/owner/ledger/notebook')

  await expect(page.getByRole('heading', { name: 'Ledger' })).toBeVisible()
  await expect(page.getByTestId('ledger-day-form')).toBeVisible()

  // Opening cash arrives inherited from the previous recorded day, because the
  // drawer really does open with what it closed on.
  await expect(page.getByTestId('opening-cash')).not.toHaveValue('')

  // Neither channel has a field to inherit into or type into: both are
  // readings fed by their own syncs, so the form offers nothing at all.
  await expect(page.getByTestId('zomato-commission')).toHaveCount(0)
  await expect(page.getByTestId('swiggy-commission')).toHaveCount(0)
  await expect(page.getByTestId('swiggy-revenue')).toHaveCount(0)

  const opening = Number(await page.getByTestId('opening-cash').inputValue())

  await page.getByTestId('cash-revenue').fill('12000')
  await page.getByTestId('upi-revenue').fill('4000')
  // Both aggregator blocks render as readings beside the fields that remain,
  // and neither offers a place where a portal figure could be pre-empted.
  await expect(page.getByTestId('aggregator-zomato')).toBeVisible()
  await expect(page.getByTestId('aggregator-swiggy')).toBeVisible()

  // The rules are one tap away rather than filling the form: the whole entry card
  // has to fit a phone, which is the only device this gets typed on.
  await expect(page.getByText(/genuinely lighter/i)).toHaveCount(0)
  await page.getByTestId('hint-drawer').click()
  await expect(page.getByTestId('hint-drawer-panel')).toContainText('genuinely lighter')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('hint-drawer-panel')).toHaveCount(0)

  // A typed category grows the shared suggestion list; the note is optional
  // detail and does not carry the reporting vocabulary.
  await page.getByTestId('add-ledger-expense').click()
  await page.getByTestId('expense-category').fill('Chicken')
  await page.getByTestId('expense-amount').fill('2400')
  await page.getByTestId('expense-description').fill('10 kg from Nadia Poultry')
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
  // The revenue side, with the commission each aggregator was actually charged. The
  // label no longer names a percentage, because there is no longer a stored one.
  await expect(page.getByTestId('recorded-revenue-net')).toBeVisible()
  await expect(page.getByTestId('ledger-day-recorded')).toContainText('Less commission')
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
  await page.goto('demo/owner/ledger/notebook')
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
  // The seeded notebook contains no double-counted aggregator category. Free
  // text permits one, but the entry field warns instead of blocking it.
  await expect(page.locator('[data-testid^="month-category-"]')).not.toHaveCount(0)
  for (const forbidden of ['month-category-zomato', 'month-category-swiggy']) {
    await expect(page.locator(`[data-testid="${forbidden}"]`)).toHaveCount(0)
  }

  await page.getByRole('link', { name: 'Manage categories' }).click()
  await expect(page.getByRole('heading', { name: 'Expense categories' })).toBeVisible()
  await expect(page.getByTestId('expense-category-list')).toContainText('Ledger')
  await expect(page.getByTestId('category-operation-log')).toBeVisible()
})

test('recording a day at each outlet keeps the two apart', async ({ page }) => {
  await page.goto('demo/owner/ledger/notebook')
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

test('a retrospective edit moves the month and never the drawer', async ({ page }) => {
  // UPI, because it is revenue-side and non-cash: correcting it changes what
  // the month's profit says without touching a single drawer figure. Both
  // aggregators would once have been the vehicle for this; they are readings
  // now, so the form's own correctable non-cash figure is the one under test.
  await page.goto('demo/owner/ledger/notebook')
  await expect(page.getByTestId('ledger-day-form')).toBeVisible()

  await page.getByTestId('cash-revenue').fill('12000')
  await page.getByTestId('upi-revenue').fill('4000')
  await page.getByTestId('counted-cash').fill('19950')
  await page.getByTestId('save-day').click()
  await expect(page.getByTestId('ledger-day-recorded')).toBeVisible()

  const expectedBefore = await page.getByTestId('expected-cash').textContent()

  await page.getByTestId('ledger-view-month').click()
  const profitBefore = await page.getByTestId('month-profit-figure').textContent()
  await page.getByTestId('ledger-view-day').click()
  await expect(page.getByTestId('expected-cash')).toHaveText(expectedBefore ?? '')

  // A recorded day opens as a reading, so correcting it is a deliberate act.
  await page.getByTestId('edit-day').click()
  await page.getByTestId('upi-revenue').fill('4500')
  await page.getByTestId('save-day').click()
  await expect(page.getByTestId('day-saved')).toBeVisible()

  // The drawer is untouched: UPI is not cash, and never was.
  await expect(page.getByTestId('expected-cash')).toHaveText(expectedBefore ?? '')

  await page.getByTestId('ledger-view-month').click()
  await expect(page.getByTestId('month-profit-figure')).not.toHaveText(profitBefore ?? '')
})

test('the ledger is in the owner’s and the manager’s navigation, and in nobody else’s', async ({
  page,
}) => {
  for (const segment of ['owner', 'admin']) {
    await page.goto(`demo/${segment}`)
    await expect(page.getByRole('link', { name: 'Ledger' }), segment).toBeVisible()
  }

  for (const role of STAFF_ROLES) {
    await page.goto(`demo/${role.segment}`)
    await expect(page.getByRole('link', { name: 'Ledger' }), role.segment).toHaveCount(0)
    // What they get instead: the expense list alone, under its own entry.
    await expect(page.getByRole('link', { name: 'Expenses' }), role.segment).toBeVisible()
  }
})

for (const role of STAFF_ROLES) {
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

  test(`the expenses surface shows a ${role.label} expenses and no day figures`, async ({
    page,
  }) => {
    await page.goto(`demo/${role.segment}/ledger/expenses`)

    await expect(page.getByTestId('ledger-expense-list')).toBeVisible()

    // Not one figure the day record holds. The drawer figures are refused by the
    // database rather than hidden here; the day's own takings are left off
    // because a screen showing four kinds of financial truth is a screen nobody
    // reads (design D5).
    await expect(page.getByTestId('day-reading')).toHaveCount(0)
    await expect(page.getByTestId('expected-cash')).toHaveCount(0)
    await expect(page.getByTestId('ledger-day-form')).toHaveCount(0)
    await expect(page.getByTestId('ledger-view-month')).toHaveCount(0)

    // Every row names who recorded it, which is what makes "your own rows"
    // legible rather than remembered.
    const first = page.getByTestId('ledger-expense-list').getByRole('listitem').first()
    await expect(first).toContainText(/\w/)
  })
}

test('a manager opens the full ledger at the outlet they manage', async ({ page }) => {
  // `ledger/notebook` since #11: the derived statement owns `ledger`, and this
  // form is one reading inside that group rather than the group itself.
  await page.goto('demo/admin/ledger/notebook')
  // The day figures included: a manager who counts the drawer nightly but cannot
  // read whether the month covered its costs is running half a shop.
  await expect(page.getByTestId('ledger-day-form')).toBeVisible()
})
