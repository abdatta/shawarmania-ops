import { expect, test, type Page } from '@playwright/test'
import { E2E_ORIGIN } from '../ports'
import { DEMO_HELPER_ACCOUNT_ID } from '../src/data-access/mock/fixtures/accounts'

/**
 * The setup walk: creating an outlet, and creating a person — through a real
 * browser, against a production build.
 *
 * These steps are what stood between a deployed attendance feature and a
 * reachable one, and neither had ever been exercised anywhere: the fixtures
 * describe a business that is already configured, so every earlier test started
 * from a world nothing in the app could have produced.
 *
 * Staff exist only as accounts, so creating a person is one act on one
 * surface: no roster row, no linking step, nothing left to finish elsewhere.
 *
 * baseURL carries the deployment sub-path, so every goto is relative.
 */

async function openOwnerOutlets(page: Page) {
  await page.goto('demo/owner/outlets')
  await expect(page.getByTestId('outlet-list')).toBeVisible()
}

test('the owner creates an outlet from the app', async ({ page }) => {
  await openOwnerOutlets(page)

  await page.getByTestId('add-outlet').click()
  await page.getByLabel('Name', { exact: true }).fill('Shawarmania Barrackpore')
  await page.getByLabel('Short code').fill('barrackpore')
  await page.getByLabel('Location label').fill('Barrackpore')
  // The arrival deadline sits beside the cutover, already filled with the 13:00
  // default — an outlet is set up without anybody having to decide it.
  await expect(page.getByLabel('Staff are expected by')).toHaveValue('13:00')
  await page.getByLabel('Staff are expected by').fill('12:30')
  await page.getByRole('button', { name: 'Create outlet' }).click()

  const card = page.getByTestId('outlet-barrackpore')
  await expect(card).toBeVisible()
  await expect(card).toContainText('staff are expected by 12:30')
  // A new outlet has never been stood in, and says so rather than judging
  // anyone against a point nobody has visited.
  await expect(page.getByTestId('uncaptured-barrackpore')).toContainText(
    'not measured against a geofence at all',
  )
  await expect(card.getByRole('button', { name: 'Capture position here' })).toBeVisible()
})

test('an outlet marked closed keeps everything and can be reopened', async ({ page }) => {
  await openOwnerOutlets(page)

  const kalyani = page.getByTestId('outlet-kalyani')
  await kalyani.getByRole('button', { name: 'Mark closed' }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('anyone mid-shift can still check out')
  await expect(dialog).toContainText('Nothing is deleted')
  await dialog.getByRole('button', { name: 'Mark closed' }).click()

  await expect(page.getByTestId('closed-kalyani')).toBeVisible()
  await page.getByTestId('outlet-kalyani').getByRole('button', { name: 'Reopen' }).click()
  await expect(page.getByTestId('closed-kalyani')).toHaveCount(0)
})

test('creating a person is one act that ends in a working handover', async ({ page }) => {
  await page.goto('demo/admin/people')
  await page.getByRole('button', { name: 'Add person' }).click()

  // One form: the account fields and the staff facts together, and never a
  // staff code — the database issues it.
  await expect(page.getByLabel('Job title (optional)')).toBeVisible()
  await expect(page.getByLabel(/Staff code/)).toHaveCount(0)

  await page.getByLabel('Full name').fill('Demo Newcomer')
  await page.getByLabel('Username', { exact: true }).fill('demo.newcomer')
  await page.getByLabel('Role', { exact: true }).selectOption('employee')
  await expect(page.locator('#account-email')).toHaveCount(0)
  await page.getByLabel('Job title (optional)').fill('Grill')
  await page.getByRole('button', { name: 'Create and issue a code' }).click()

  // The handover, once: link and code image.
  const panel = page.getByTestId('account-handover')
  await expect(panel).toBeVisible()
  await expect(panel).toContainText('Shown once')
  await expect(page.getByTestId('account-handover-username')).toContainText('demo.newcomer')

  // And the person is on the staff list at once, already placed at an outlet —
  // there is no second surface where they still have to be added or linked.
  const row = page.getByRole('row', { name: /Demo Newcomer/ })
  await expect(row).toBeVisible()
  await expect(row).toContainText('Shawarmania Kalyani')
})

test('the people states each say what is wrong and what to do', async ({ page }) => {
  await page.goto('demo/admin/people')

  // Ordinary staff have a username and no email-dependent repair state.
  await expect(page.getByTestId(`username-${DEMO_HELPER_ACCOUNT_ID}`)).toContainText('demo.helper')
  await expect(page.getByRole('row', { name: /Demo Helper/ })).not.toContainText('Needs an address')

  // Provisioned, activated by nobody yet.
  await expect(page.getByRole('row', { name: /Demo New Starter/ })).toContainText(
    'Set-up link issued',
  )

  // Access cut without leaving: still on the list, plainly marked.
  await expect(page.getByRole('row', { name: /Demo Prep Cook/ })).toContainText('Deactivated')

  // Somebody who works nowhere is off the working list, and one tap away —
  // records kept, clutter gone. Its lifecycle still states the stronger truth:
  // sign-in is deactivated, not merely that no outlet is assigned.
  await expect(page.getByText('Demo Former Staff')).toHaveCount(0)
  await page.getByTestId('toggle-departed').click()
  await expect(page.getByRole('row', { name: /Demo Former Staff/ })).toContainText('Deactivated')

  // And the person who left one outlet is still on the working list, because
  // they still work at the other.
  await expect(page.getByRole('row', { name: /Demo Returner/ })).toContainText(
    'Shawarmania Kalyani',
  )
})

test('the whole setup walk stays inside the app origin', async ({ page, baseURL }) => {
  // The demo tree is structurally incapable of reaching a backend, and the
  // writes this change makes must not be the exception that proves otherwise.
  const origin = new URL(baseURL ?? E2E_ORIGIN).origin
  const foreign: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== origin) foreign.push(request.url())
  })

  await openOwnerOutlets(page)
  await page.getByTestId('add-outlet').click()
  await page.getByLabel('Name', { exact: true }).fill('Shawarmania Barrackpore')
  await page.getByLabel('Short code').fill('barrackpore')
  await page.getByLabel('Location label').fill('Barrackpore')
  await page.getByRole('button', { name: 'Create outlet' }).click()
  await expect(page.getByTestId('outlet-barrackpore')).toBeVisible()

  await page.goto('demo/admin/people')
  await page.getByRole('button', { name: 'Add person' }).click()
  await page.getByLabel('Full name').fill('Demo Origin Probe')
  await page.getByLabel('Username', { exact: true }).fill('demo.origin.probe')
  await page.getByLabel('Role', { exact: true }).selectOption('employee')
  await expect(page.locator('#account-email')).toHaveCount(0)
  await page.getByRole('button', { name: 'Create and issue a code' }).click()
  await expect(page.getByTestId('account-handover')).toBeVisible()

  expect(foreign).toEqual([])
})

test('an address is filled from a search, and the search never leaves the origin', async ({
  page,
  baseURL,
}) => {
  // The address lookup is the first feature in this app that would legitimately
  // call somebody else's service. In demo mode it must not — and the failure
  // mode if it did is invisible in the UI, which is exactly why this asserts on
  // the network rather than on the screen.
  const origin = new URL(baseURL ?? E2E_ORIGIN).origin
  const foreign: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== origin) foreign.push(request.url())
  })

  await openOwnerOutlets(page)
  await page.getByTestId('add-outlet').click()
  await page.getByLabel('Name', { exact: true }).fill('Shawarmania Barrackpore')
  await page.getByLabel('Short code').fill('barrackpore')

  await page.getByRole('combobox', { name: /Find the address/ }).fill('Central Park')
  await page.getByRole('option', { name: /Central Park/ }).click()

  // One action, four fields — plus the district, which comes from the PIN
  // because no geocoder answers it correctly for India.
  await expect(page.getByLabel('Address (optional)')).toHaveValue('Central Park')
  await expect(page.getByLabel('Address line 2')).toHaveValue('B-7')
  await expect(page.getByLabel('City')).toHaveValue('Kalyani')
  await expect(page.getByLabel('PIN code')).toHaveValue('741235')
  await expect(page.getByLabel('District')).toHaveValue('Nadia')

  // The label was empty, so the pick filled it; nothing overwrote anything.
  await expect(page.getByLabel('Location label')).toHaveValue('Kalyani — Central Park')

  await page.getByRole('button', { name: 'Create outlet' }).click()
  await expect(page.getByTestId('outlet-barrackpore')).toBeVisible()

  // A picked address must never survey an outlet: the fence is captured on
  // site, and a rooftop centroid would mark somebody absent at their own counter.
  await expect(page.getByTestId('uncaptured-barrackpore')).toContainText(
    'not measured against a geofence at all',
  )

  expect(foreign).toEqual([])
})
