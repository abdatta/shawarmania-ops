import { expect, test } from './test'

/**
 * Campaigns in the demo (a-campaign-goes-out-on-whatsapp, #85): the owner walks
 * the surface end to end, and nobody else has a way in.
 *
 * Each test moves inside the app after its first page: the demo keeps its data
 * in the page, so a reload starts it again. Nothing here sends anything; the
 * suite's own tripwire fails on any request leaving the app's origin.
 */

test('the owner writes, submits, pauses and stops a campaign, and sends nothing', async ({
  page,
}) => {
  await page.goto('demo/owner/campaigns')
  await expect(page.getByTestId('sender-line')).toContainText('Sender online · sending batch 3')
  await expect(page.getByTestId('campaign-list').getByRole('link')).toHaveCount(3)
  // It is in the owner's navigation, beside Customers.
  const rail = page.getByRole('navigation', { name: 'Primary' })
  await expect(rail.getByRole('link', { name: 'Campaigns' })).toBeVisible()
  await expect(rail.getByRole('link', { name: 'Customers' })).toBeVisible()

  // Every state the laptop can be in, from the demo banner.
  const sender = page.getByLabel('Demo campaign sender')
  await sender.selectOption('offline')
  await expect(page.getByTestId('sender-line')).toContainText('Sender offline since yesterday')
  await sender.selectOption('halted')
  await expect(page.getByTestId('sender-line')).toContainText('Sender halted')
  await sender.selectOption('not_linked')
  await expect(page.getByTestId('sender-line')).toHaveText(
    'Sender not linked · link it on the laptop',
  )
  await sender.selectOption('waiting')
  await expect(page.getByTestId('sender-line')).toContainText('batch 3 waiting on the laptop')

  // The part-sent campaign: its batch waits on the laptop, with nothing to press.
  await page
    .getByTestId('campaign-list')
    .getByRole('link', { name: /Diwali offer/ })
    .click()
  await expect(page.getByTestId('batch-3')).toContainText('send from the laptop')
  await expect(page.getByRole('button', { name: /send|release/i })).toHaveCount(0)
  await page.getByRole('button', { name: 'Pause' }).click()
  await expect(page.getByTestId('campaign-state')).toHaveText('paused')
  await page.getByRole('button', { name: 'Resume' }).click()
  await page.getByTestId('stop-campaign').click()
  await page.getByRole('dialog').getByRole('button', { name: 'Stop' }).click()
  await expect(page.getByTestId('campaign-state')).toHaveText('stopped')
  await page.getByRole('button', { name: 'Back' }).click()

  // A new one: the bubble follows the typing, and Submit says what happens next.
  await page.getByRole('link', { name: 'Add a campaign' }).click()
  await page.getByTestId('campaign-name').fill('Monsoon')
  await page.getByTestId('campaign-body').fill('Hi {name}, *hot* rolls on a rainy day.')
  await expect(page.getByTestId('message-bubble')).toContainText('Hi Demo, hot rolls')
  await expect(page.getByTestId('message-bubble')).toContainText(
    'Reply STOP to stop these messages.',
  )
  await page.getByTestId('choose-audience').click()
  // The customers are the sheet: there as it opens, by name and last four
  // digits, nobody ticked, and more as the list is scrolled.
  const people = page.getByTestId('audience-people')
  await expect.poll(() => people.getByRole('listitem').count()).toBeGreaterThanOrEqual(20)
  await expect(people).toContainText('Moumta Ghosh')
  await expect(people).not.toContainText('90000')
  await expect(page.getByTestId('audience-sheet-count')).toHaveText('0 selected')
  await expect(page.getByTestId('audience-done')).toBeDisabled()
  await page.getByTestId('audience-more').scrollIntoViewIfNeeded()
  await expect.poll(() => people.getByRole('listitem').count()).toBeGreaterThan(20)

  // One found by search and ticked.
  await page.getByTestId('audience-search').fill('ritika')
  await expect(people.getByRole('listitem')).toHaveCount(1)
  await page.getByRole('checkbox', { name: 'Pick Ritika Sen' }).check()
  await expect(page.getByTestId('audience-sheet-count')).toHaveText('1 selected')
  await page.getByTestId('audience-search').fill('')

  // Or everybody the filters match: the six seen in the last 30 days.
  await page.getByTestId('audience-filter').click()
  await page
    .getByRole('dialog', { name: 'Filter customers' })
    .getByRole('region', { name: 'Last ordered' })
    .getByRole('radio', { name: 'Last 30 days' })
    .click()
  await page.getByTestId('audience-filter-done').click()
  await expect(page.getByTestId('audience-filter-summary')).toHaveText('Last 30 days')
  await expect(page.getByTestId('audience-select-all').locator('..')).toContainText('Select all 6')
  await page.getByTestId('audience-select-all').check()
  await expect(page.getByTestId('audience-sheet-count')).toHaveText('6 selected')
  await page.getByTestId('audience-done').click()
  await expect(page.getByTestId('audience-count')).toHaveText('6 customers')
  await page.getByTestId('submit-campaign').click()
  await expect(page.getByRole('dialog')).toContainText('each batch is sent from the laptop')
  await page.getByRole('dialog').getByRole('button', { name: 'Submit' }).click()
  await expect(page.getByTestId('campaign-state')).toHaveText('submitted')
  await expect(page.getByTestId('batch-1')).toContainText('send from the laptop')
  await expect(page.getByTestId('tile-sent')).toContainText('0')

  // The stopped list.
  await page.getByRole('button', { name: 'Back' }).click()
  await page.getByTestId('open-stopped').click()
  await expect(page.getByTestId('stopped-list').getByRole('listitem')).toHaveCount(7)
})

for (const [shell, role] of [
  ['admin', 'a manager'],
  ['staff', 'an employee'],
] as const) {
  test(`${role} has no Campaigns entry, and its address is not a page`, async ({ page }) => {
    await page.goto(`demo/${shell}`)
    const rail = page.getByRole('navigation', { name: 'Primary' })
    await expect(rail.getByRole('link').first()).toBeVisible()
    // Every group opened, so an entry folded behind a heading would be found.
    for (const group of await rail.getByRole('button').all()) await group.click()
    await expect(rail.getByText('Campaigns')).toHaveCount(0)

    await page.goto(`demo/${shell}/campaigns`)
    await expect(page.getByText('That page does not exist')).toBeVisible()
    await page.goto(`demo/${shell}/campaigns/stopped`)
    await expect(page.getByText('That page does not exist')).toBeVisible()
  })
}

test('the counter tablet has no Campaigns page', async ({ page }) => {
  await page.goto('demo/biller/campaigns')
  await expect(page.getByText('That page does not exist')).toBeVisible()
})
