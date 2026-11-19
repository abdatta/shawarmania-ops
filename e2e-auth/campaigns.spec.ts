import { type Page } from '@playwright/test'
import { expect, test } from './test'

import { OUTLET_KALYANI } from './tills'

/**
 * Campaigns against the real database (a-campaign-goes-out-on-whatsapp, #85,
 * task 3.4).
 *
 * Who may call what is proved in pgTAP and the REST probes; this proves the
 * pages read and write through the functions on a phone: the owner writes a
 * campaign with a picture, picks its customers through a filter, submits,
 * pauses, resumes and stops it, and every step is the database's answer, not
 * the page's own state. A manager has no entry and no address.
 *
 * Nothing is sent. The app never sends; it queues, and the sender on the
 * owner's laptop sends, and there is no laptop here. The campaign is stopped
 * before the test ends, so a later run on the shared stack finds no batch of
 * this one waiting ahead of its own.
 *
 * The seed's `Test Customer (Synthetic)` has bills at Kalyani from today and
 * two days ago, so the last thirty days at Kalyani find them. They are found
 * by the list's search, by their number, not by reading the list or by name:
 * the list loads a page at a time, most orders first, and specs that run
 * before this one on the same stack add customers ahead of them (staging run
 * 44556801404); and a billing spec rings that number under another name,
 * which the customer's saved name then is (run 44559955525, gates on).
 */

const RUN = Date.now().toString(36).slice(-6)
/** The seed customer's number, which no spec changes. Only its last four may be shown. */
const SHARED_NUMBER = '9000000001'

/** A 1×1 PNG: the page draws it again as a JPEG before uploading. */
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

test.use({ viewport: { width: 390, height: 844 } })

async function signIn(page: Page, username: string) {
  await page.goto('sign-in')
  await page.getByLabel('Username or email', { exact: true }).fill(username)
  await page.getByLabel('Password').fill('shawarmania-local')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible()
}

/** The picture as the browser drew it: loaded from its signed address, not broken. */
async function pictureLoaded(page: Page) {
  const image = page.getByTestId('message-image')
  await expect(image).toHaveAttribute('src', /\/storage\/v1\/object\/sign\/campaign-images\//)
  await expect
    .poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth))
    .toBeGreaterThan(0)
}

test('the owner writes, filters, submits, pauses and stops a campaign', async ({ page }) => {
  await signIn(page, 'owner')
  await page.goto('owner/campaigns')
  await expect(page.getByRole('heading', { name: 'Campaigns', exact: true })).toBeVisible()
  // In the owner's navigation for real, not only in the demo.
  await expect(
    page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Campaigns' }),
  ).toBeVisible()
  await expect(page.getByTestId('sender-line')).toBeVisible()

  // Written, with a picture: the first picture saves the draft, and is uploaded.
  const name = `Monsoon ${RUN}`
  await page.getByRole('link', { name: 'Add a campaign' }).click()
  await page.getByTestId('campaign-name').fill(name)
  await page.getByTestId('campaign-body').fill('Hi {name}, *hot* rolls on a rainy day.')
  await expect(page.getByTestId('message-bubble')).toContainText('hot rolls on a rainy day.')
  await page
    .getByTestId('campaign-image-input')
    .setInputFiles({ name: 'rolls.png', mimeType: 'image/png', buffer: PIXEL })
  await expect(page.getByTestId('campaign-image')).toHaveText(/Change/)
  await pictureLoaded(page)

  // Picked through a filter, from the database's own list.
  await page.getByTestId('choose-audience').click()
  const kalyani = page.getByTestId(`surface-outlet-${OUTLET_KALYANI}`)
  if ((await kalyani.count()) > 0 && (await kalyani.getAttribute('aria-pressed')) !== 'true') {
    await kalyani.click()
  }
  const people = page.getByTestId('audience-people')
  const search = page.getByTestId('audience-search')
  await search.fill(SHARED_NUMBER)
  // Found, shown by its last four digits, and never by the whole number.
  await expect(people).toContainText('0001')
  await expect(people).not.toContainText(SHARED_NUMBER)
  await search.fill('')
  await page.getByTestId('audience-filter').click()
  await page
    .getByRole('dialog', { name: 'Filter customers' })
    .getByRole('region', { name: 'Last ordered' })
    .getByRole('radio', { name: 'Last 30 days' })
    .click()
  await page.getByTestId('audience-filter-done').click()
  await expect(page.getByTestId('audience-filter-summary')).toHaveText('Last 30 days')
  await search.fill(SHARED_NUMBER)
  await expect(people).toContainText('0001')
  await search.fill('')
  await page.getByTestId('audience-select-all').check()
  await expect(page.getByTestId('audience-sheet-count')).not.toHaveText('0 selected')
  await page.getByTestId('audience-done').click()
  await expect(page.getByTestId('audience-count')).toHaveText(/^\d+ customers?$/)

  // Submitted: cut into batches by the database, waiting on the laptop.
  await page.getByTestId('submit-campaign').click()
  await page.getByRole('dialog').getByRole('button', { name: 'Submit' }).click()
  await expect(page.getByTestId('campaign-state')).toHaveText('submitted')
  await expect(page.getByTestId('batch-1')).toBeVisible()
  await expect(page.getByTestId('tile-sent')).toContainText('0')

  // Read again from nothing: what is on screen is what the database holds.
  await page.reload()
  await expect(page.getByTestId('campaign-state')).toHaveText('submitted')
  await pictureLoaded(page)

  await page.getByTestId('pause-campaign').click()
  await expect(page.getByTestId('campaign-state')).toHaveText('paused')
  await page.getByTestId('resume-campaign').click()
  await expect(page.getByTestId('campaign-state')).toHaveText('submitted')
  await page.getByTestId('stop-campaign').click()
  await page.getByRole('dialog').getByRole('button', { name: 'Stop' }).click()
  await expect(page.getByTestId('campaign-state')).toHaveText('stopped')

  await page.getByRole('button', { name: 'Back' }).click()
  // By its own name: a retry's first attempt may have left a Monsoon of its own.
  await expect(
    page.getByTestId('campaign-list').getByRole('link').filter({ hasText: name }),
  ).toBeVisible()
})

test('a manager has no Campaigns entry, and a typed address is not a page', async ({ page }) => {
  await signIn(page, 'admin.kalyani')
  const rail = page.getByRole('navigation', { name: 'Primary' })
  await expect(rail.getByRole('link').first()).toBeVisible()
  // Every group opened, so an entry folded behind a heading would be found.
  for (const group of await rail.getByRole('button').all()) await group.click()
  await expect(rail.getByText('Campaigns')).toHaveCount(0)

  await page.goto('admin/campaigns')
  await expect(page.getByText('That page does not exist')).toBeVisible()
  await page.goto('admin/campaigns/stopped')
  await expect(page.getByText('That page does not exist')).toBeVisible()

  // The owner's address, typed by a manager, is not the owner's page.
  await page.goto('owner/campaigns')
  await expect(page.getByRole('navigation', { name: 'Primary' }).first()).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Campaigns', exact: true })).toHaveCount(0)
  await expect(page.getByTestId('campaign-list')).toHaveCount(0)
})
