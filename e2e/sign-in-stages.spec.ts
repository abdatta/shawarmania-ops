import { expect, test } from './test'
import { OUTLET_KANCHRAPARA_ID } from '../src/data-access/mock/fixtures/outlets'

/**
 * A sign-in, told as it happens, in a real browser (#46).
 *
 * The demo walks the same stages a real sign-in records, so this is the walk
 * the owner approves: tap Reconnect, watch the card become the stage list, see
 * the code field appear only at "Waiting for your code", give a code, and end
 * signed back in with nothing asking for a second sign-in. Then the refused
 * code, because a tick that silently unticks is the one thing the stepper must
 * never do.
 */

async function openLapsedSwiggy(page: import('@playwright/test').Page) {
  await page.goto('demo/owner/ledger/delivery/swiggy')
  await expect(page.getByTestId('demo-banner')).toBeVisible()
  await page.getByTestId(`surface-outlet-${OUTLET_KANCHRAPARA_ID}`).click()
  await page.getByTestId('needs-reconnect-swiggy').click()
}

const step = (page: import('@playwright/test').Page, name: string) =>
  page.locator(`[data-step="${name}"]`)

test('Reconnect becomes the stage list, and the code is asked for at its own stage', async ({
  page,
}) => {
  await openLapsedSwiggy(page)

  const card = page.getByTestId('swiggy-sign-in')
  await expect(card).toHaveAttribute('data-sign-in-state', 'live')
  // The steps sit over a page that takes no input, and nothing offers a second
  // Reconnect; the rest of the app is still a tap away.
  await expect(page.getByTestId('swiggy-sign-in-lock')).toBeVisible()
  await expect(page.locator('[inert]').getByRole('button', { name: 'Read now' })).toHaveCount(1)
  await expect(page.getByRole('button', { name: /reconnect/i })).toHaveCount(0)

  // Before the code stage there is no code field anywhere on the page.
  await expect(step(page, 'opening_portal')).toHaveAttribute('data-step-state', /current|past/)
  await expect(page.getByLabel(/one time password/i)).toHaveCount(0)

  await expect(step(page, 'waiting_for_code')).toHaveAttribute('data-step-state', 'current', {
    timeout: 20_000,
  })
  await expect(step(page, 'signing_in')).toHaveAttribute('data-step-state', 'past')
  const field = step(page, 'waiting_for_code').getByLabel(/one time password swiggy sent/i)
  await expect(field).toBeVisible()
  await expect(page.getByTestId('swiggy-otp-left')).toContainText('left')
  await expect(page.getByLabel(/one time password/i)).toHaveCount(1)

  await field.fill('123456')
  await page.getByRole('button', { name: 'Sign back in' }).click()

  // Every step ticked, held until the owner says Done.
  await page.getByTestId('swiggy-sign-in-done').click({ timeout: 20_000 })
  await expect(page.getByTestId('swiggy-sign-in-lock')).toHaveCount(0)
  await expect(page.getByTestId('swiggy-signed-back-in')).toBeVisible()
  await expect(page.getByTestId('needs-reconnect-swiggy')).toHaveCount(0)
})

test('the sign-in is still there after leaving the page and coming back', async ({ page }) => {
  await openLapsedSwiggy(page)
  await expect(step(page, 'opening_portal')).toHaveAttribute('data-step-state', /current|past/)

  // In-app, so the demo's sign-in keeps walking while the page is away.
  await page.getByRole('link', { name: 'Team' }).first().click()
  await expect(page).toHaveURL(/\/team$/)
  await page.goBack()

  await expect(page.getByTestId('swiggy-sign-in-lock')).toBeVisible()
  await expect(step(page, 'waiting_for_code')).toHaveAttribute('data-step-state', 'current', {
    timeout: 20_000,
  })
})

test('a refused code says so and the field comes back, rather than a silent untick', async ({
  page,
}) => {
  await openLapsedSwiggy(page)

  const waiting = step(page, 'waiting_for_code')
  await expect(waiting).toHaveAttribute('data-step-state', 'current', { timeout: 20_000 })
  // The demo refuses this one code, so the retry can be walked.
  await waiting.getByLabel(/one time password/i).fill('000000')
  await page.getByRole('button', { name: 'Sign back in' }).click()

  await expect(waiting.getByRole('alert')).toContainText('not accepted', { timeout: 15_000 })
  await expect(waiting).toHaveAttribute('data-step-state', 'current')
  await expect(step(page, 'checking_code')).toHaveAttribute('data-step-state', 'upcoming')
  await expect(waiting.getByLabel(/one time password/i)).toBeVisible()
})
