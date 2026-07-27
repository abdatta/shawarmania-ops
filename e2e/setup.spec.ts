import { expect, test, type Page } from '@playwright/test'

/**
 * The setup walk: creating an outlet, and joining an app account to the person
 * it belongs to — through a real browser, against a production build.
 *
 * These two steps are what stood between a deployed attendance feature and a
 * reachable one, and neither had ever been exercised anywhere: the fixtures
 * describe a business that is already configured, so every earlier test started
 * from a world nothing in the app could have produced.
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
  await page.getByRole('button', { name: 'Create outlet' }).click()

  const card = page.getByTestId('outlet-barrackpore')
  await expect(card).toBeVisible()
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

test('an account and a person on the roster are joined, and the join is legible', async ({
  page,
}) => {
  await page.goto('demo/admin/employees')

  // The demo ships both halves of the unfinished state on purpose.
  await expect(page.getByTestId('unlinked-KAL-02')).toContainText('No app account')
  await expect(page.getByTestId('linked-KAL-01')).toContainText('Demo Staff')

  const row = page.getByTestId('unlinked-KAL-02').locator('xpath=ancestor::tr')
  await row.getByRole('button', { name: 'Edit' }).click()
  await page.getByLabel('App account').selectOption({ label: 'Demo Griller' })
  await page.getByRole('button', { name: 'Save changes' }).click()

  await expect(page.getByTestId('linked-KAL-02')).toContainText('Demo Griller')
  await expect(page.getByTestId('unlinked-KAL-02')).toHaveCount(0)
})

test('unlinking says what it costs and what it keeps', async ({ page }) => {
  await page.goto('demo/admin/employees')

  const row = page.getByTestId('linked-KAL-01').locator('xpath=ancestor::tr')
  await row.getByRole('button', { name: 'Unlink' }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('stops being able to check in')
  await expect(dialog).toContainText('those days were worked')
  await dialog.getByRole('button', { name: 'Unlink' }).click()

  await expect(page.getByTestId('unlinked-KAL-01')).toContainText('No app account')
})

test('provisioning an Employee asks about the staff list rather than deciding', async ({
  page,
}) => {
  await page.goto('demo/admin/people')
  await page.getByRole('button', { name: 'Add account' }).click()

  const choice = page.getByRole('group', { name: 'Staff list' })
  await expect(choice).toBeVisible()
  await expect(page.getByLabel('Add them to the staff list')).toBeChecked()
  await expect(page.getByLabel('Not on the staff list')).toBeVisible()

  // And an account already provisioned onto no roster says so on the list.
  await page.getByRole('button', { name: 'Close' }).click()
  await expect(page.getByTestId('off-roster-d1000000-0000-4000-a000-000000000008')).toContainText(
    'cannot check in',
  )
})

test('the whole setup walk stays inside the app origin', async ({ page, baseURL }) => {
  // The demo tree is structurally incapable of reaching a backend, and the two
  // writes this change adds must not be the exception that proves otherwise.
  const origin = new URL(baseURL ?? 'http://127.0.0.1:4173/').origin
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

  await page.goto('demo/admin/employees')
  const row = page.getByTestId('unlinked-KAL-02').locator('xpath=ancestor::tr')
  await row.getByRole('button', { name: 'Edit' }).click()
  await page.getByLabel('App account').selectOption({ label: 'Demo Griller' })
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByTestId('linked-KAL-02')).toBeVisible()

  expect(foreign).toEqual([])
})
