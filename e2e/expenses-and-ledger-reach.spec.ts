import { expect, test } from '@playwright/test'

/**
 * Who reaches the Ledger and the expense list, and who does not.
 *
 * This was `manual-ledger.spec.ts` and gated the notebook (#36) — a form that
 * could be typed into. `retire-the-manual-ledger` (#12) removed that surface and
 * its route, so what survives here is the half that was never about the form:
 * **reach**. The derived Ledger is in the owner's and the manager's navigation
 * and in nobody else's; outlet staff get the expense list alone, with not one
 * figure the retired day record used to hold; and the Biller reaches it as a
 * panel beneath the till rather than as a tab.
 *
 * baseURL carries the deployment sub-path, so every goto here is relative.
 *
 * The claims are the ones a component test cannot make against a real build:
 * they are about navigation, routing and what a whole shell renders.
 */

// Outlet staff only. `the-ledger-opens-to-the-outlet` gave the manager the
// ledger at the outlets they are assigned to, so the Admin's case is asserted
// below as reachable rather than here as absent.
const STAFF_ROLES = [
  { segment: 'biller', label: 'Biller' },
  { segment: 'staff', label: 'Staff' },
] as const

test('the ledger is in the owner’s and the manager’s navigation, and in nobody else’s', async ({
  page,
}) => {
  for (const segment of ['owner', 'admin']) {
    await page.goto(`demo/${segment}`)
    await expect(page.getByRole('link', { name: 'Ledger' }), segment).toBeVisible()
  }

  // The Employee gets the expense list alone, under its own entry.
  await page.goto('demo/staff')
  await expect(page.getByRole('link', { name: 'Ledger' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Expenses' })).toBeVisible()

  // The Biller has no navigation of any kind: their shell is the counter
  // tablet, which offers no tabs, no account menu and no way out. Expenses
  // reaches them as a panel beneath the till instead — the drawer is at the
  // counter, and the person spending is often the person billing.
  await page.goto('demo/biller')
  await expect(page.getByRole('link', { name: 'Ledger' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Expenses' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Expenses' })).toBeVisible()
  await expect(page.getByTestId('add-ledger-expense')).toBeVisible()
})

/**
 * **There is no second navigation entry beside the Ledger.**
 *
 * The notebook sat at `ledger/notebook` with its own `Notebook` entry for as
 * long as the derived statement was being proved against it. #12 ended that
 * overlap, and this is the assertion that the entry went with the surface rather
 * than being merely hidden.
 */
test('the notebook is gone from the navigation and from the routes', async ({ page }) => {
  for (const segment of ['owner', 'admin']) {
    await page.goto(`demo/${segment}`)
    await expect(page.getByRole('link', { name: 'Notebook' }), segment).toHaveCount(0)

    // Absent rather than forbidden: no surface is declared at this path any
    // more, so it lands on the shell's own not-found — the same treatment any
    // other undeclared path gets.
    await page.goto(`demo/${segment}/ledger/notebook`)
    await expect(page.getByText('That page does not exist'), segment).toBeVisible()
    await expect(page.getByTestId('ledger-day-form'), segment).toHaveCount(0)
    // Still inside the demo, so the banner still stands.
    await expect(page.getByTestId('demo-banner'), segment).toBeVisible()
  }
})

for (const role of STAFF_ROLES) {
  test(`the ledger path renders nothing for a ${role.label}`, async ({ page }) => {
    await page.goto(`demo/${role.segment}/ledger`)

    // Absent rather than forbidden: no ledger surface is declared for this role,
    // so the route lands on the shell's own not-found.
    await expect(page.getByText('That page does not exist')).toBeVisible()
    await expect(page.getByTestId('ledger-revenue')).toHaveCount(0)
    await expect(page.getByTestId('demo-banner')).toBeVisible()
  })

  test(`the expenses surface shows a ${role.label} expenses and no day figures`, async ({
    page,
  }) => {
    // The Biller reaches it on the tablet itself, which is a leaf address with
    // nothing beneath it — exactly as `/counter` is in production.
    await page.goto(
      role.segment === 'biller' ? 'demo/biller' : `demo/${role.segment}/ledger/expenses`,
    )

    // Anchored on the control that records a spend: the tablet's panel is scoped
    // to the running day, which may honestly have nothing on it yet.
    await expect(page.getByTestId('add-ledger-expense')).toBeVisible()

    // Not one figure the retired day record held. The drawer figures are refused
    // by the database rather than hidden here; the day's own takings are left
    // off because a screen showing four kinds of financial truth is a screen
    // nobody reads (design D5).
    await expect(page.getByTestId('day-reading')).toHaveCount(0)
    await expect(page.getByTestId('expected-cash')).toHaveCount(0)
    await expect(page.getByTestId('ledger-day-form')).toHaveCount(0)
    await expect(page.getByTestId('ledger-view-month')).toHaveCount(0)

    // The tablet's panel is scoped to the running day, and since #12 it reads the
    // same expense record every other surface does — so the counter's own
    // purchases are listed there instead of the empty state the split used to
    // produce. Every row names its category and amount, which is what makes
    // "your own rows" legible rather than remembered.
    const first = page.getByTestId('ledger-expense-list').getByRole('listitem').first()
    await expect(first).toContainText(/\w/)
  })
}

test('a manager opens the derived ledger at the outlet they manage', async ({ page }) => {
  await page.goto('demo/admin/ledger')
  // The day figures included: a manager who counts the drawer nightly but cannot
  // read whether the month covered its costs is running half a shop.
  await expect(page.getByTestId('ledger-revenue')).toBeVisible()
})
