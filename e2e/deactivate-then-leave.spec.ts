import { type Page } from '@playwright/test'
import { expect, test } from './test'
import {
  DEMO_DEACTIVATED_BILLER_ACCOUNT_ID,
  DEMO_HELPER_ACCOUNT_ID,
} from '../src/data-access/mock/fixtures/accounts'

/**
 * A deactivated person leaves in two steps, in the demo
 * (a-deactivated-person-leaves-in-two-steps), against a production build and a
 * real browser.
 *
 * The clock is pinned to midday in Kolkata, so the calendar day a deactivation
 * is dated by and the business day the roll-call reads are the same day.
 *
 * baseURL carries the deployment sub-path, so every goto is relative.
 */

const MIDDAY = new Date('2026-07-20T12:00:00+05:30')

async function openActions(page: Page, name: string) {
  const row = page.getByRole('row', { name: new RegExp(name) })
  await row.getByRole('button', { name: /^Actions for / }).click()
  return row
}

test('a manager deactivates somebody into Deactivated, and removes another', async ({ page }) => {
  await page.clock.setFixedTime(MIDDAY)
  await page.goto('demo/admin/team')
  await expect(page.getByRole('row', { name: /Demo Helper/ })).toBeVisible()
  // Switched off ten days back, kept off the working list.
  await expect(page.getByRole('row', { name: /Demo Weekend Biller/ })).toHaveCount(0)
  await expect(page.getByTestId('toggle-departed')).toHaveCount(0)
  const toggle = page.getByTestId('toggle-deactivated')
  await expect(toggle).toHaveText('Deactivated · 2 · Show')

  let row = await openActions(page, 'Demo Helper')
  await row.getByRole('button', { name: 'Deactivate' }).click()
  const deactivate = page.getByRole('dialog', { name: 'Deactivate Demo Helper?' })
  await expect(deactivate).toContainText('They move to Deactivated')
  await deactivate.getByRole('button', { name: 'Deactivate' }).click()
  await expect(toggle).toHaveText('Deactivated · 3 · Hide')
  // Said where the thumb is, with the section they moved to already open.
  await expect(page.getByTestId('team-notice')).toHaveText(/Demo Helper deactivated/)
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByTestId(`deactivated-${DEMO_HELPER_ACCOUNT_ID}`)).toHaveText(
    'Deactivated · 20 Jul',
  )
  await expect(page.getByTestId(`deactivated-${DEMO_DEACTIVATED_BILLER_ACCOUNT_ID}`)).toHaveText(
    'Deactivated · 10 Jul',
  )

  row = await openActions(page, 'Demo Weekend Biller')
  await row.getByRole('button', { name: 'Remove' }).click()
  const leave = page.getByRole('dialog', { name: 'Remove Demo Weekend Biller from Team?' })
  await expect(leave).toContainText('Their attendance and work stay on record.')
  await expect(leave).toContainText('demo.weekend.biller')
  await leave.getByRole('button', { name: 'Remove' }).click()
  await expect(page.getByTestId('team-notice')).toHaveText(/Demo Weekend Biller removed/)

  await expect(page.getByRole('row', { name: /Demo Weekend Biller/ })).toHaveCount(0)
  await expect(toggle).toHaveText('Deactivated · 2 · Hide')
})

test('By day lists a deactivated person on their deactivation day and not the day after', async ({
  page,
}) => {
  await page.clock.setFixedTime(MIDDAY)
  await page.goto('demo/admin/attendance')
  await expect(page.getByTestId('attendance-day')).toBeVisible()
  // Today is the 20th; the Biller was deactivated on the 10th.
  for (let step = 0; step < 9; step += 1) {
    await page.getByRole('button', { name: 'Previous day' }).click()
  }
  await expect(page.getByTestId('day-label')).toHaveText('11 Jul 2026')
  await expect(page.getByTestId(`day-${DEMO_DEACTIVATED_BILLER_ACCOUNT_ID}`)).toHaveCount(0)

  await page.getByRole('button', { name: 'Previous day' }).click()
  await expect(page.getByTestId('day-label')).toHaveText('10 Jul 2026')
  const card = page.getByTestId(`day-${DEMO_DEACTIVATED_BILLER_ACCOUNT_ID}`)
  await expect(card).toBeVisible()
  await expect(card).toContainText('deactivated')
})

test('the owner is offered no owner access to grant or remove', async ({ page }) => {
  await page.goto('demo/owner/team')
  await page.getByRole('button', { name: 'Add person' }).click()
  const form = page.getByRole('dialog', { name: 'Add person' })
  expect(await form.getByLabel('Role').locator('option').allTextContents()).not.toContain('Owner')
  await form.getByRole('button', { name: 'Close' }).click()

  const row = await openActions(page, 'Demo Griller')
  await row.getByRole('button', { name: 'Edit' }).click()
  const editor = page.getByRole('dialog', { name: /Edit Demo Griller/ })
  await expect(editor.getByRole('button', { name: 'Grant owner access' })).toHaveCount(0)
  await expect(editor.getByRole('region', { name: 'Owner access' })).toHaveCount(0)
})
