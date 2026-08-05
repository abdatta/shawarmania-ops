import { expect, test } from '@playwright/test'

import { E2E_ORIGIN } from '../ports'

/**
 * The activation handover, in demo mode.
 *
 * Activation itself has no demo counterpart — demo mode is authentication-free
 * by design, which is exactly what lets it exist without a backend. What IS
 * demonstrable is the half an admin performs: provisioning somebody and being
 * handed a link and a scannable code.
 *
 * That handover is worth a walk of its own for one reason: the QR. A code
 * fetched from an image service would work perfectly, look identical, and
 * quietly break the guarantee the whole demo tree rests on — while handing a
 * live bearer credential to a third party on the way to the screen.
 */
test('an admin is handed one username-only activation link', async ({ page }) => {
  await page.goto('demo/owner/people')
  await expect(page.getByRole('heading', { name: 'People' })).toBeVisible()

  await page.getByRole('button', { name: 'Add person' }).click()
  await page.getByLabel('Full name').fill('Demo Fresh Hire')
  await page.getByLabel('Username', { exact: true }).fill('demo.fresh.hire')
  await page.getByRole('checkbox', { name: 'Shawarmania Kalyani' }).check()
  await page.getByRole('checkbox', { name: 'Shawarmania Kanchrapara' }).check()
  await expect(page.getByLabel('Staff code')).toHaveCount(0)
  await page.getByRole('button', { name: 'Create and issue a code' }).click()

  const panel = page.getByTestId('issued-code')
  await expect(panel).toBeVisible()

  const link = (await panel.getByTestId('issued-code-link').innerText()).trim()
  const code = new URL(link).searchParams.get('code')!

  expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/)
  // The username is on the panel for the admin to check, never in the URL.
  expect(link).not.toContain('@')

  // One handover. The code lives inside the URL and is deliberately not
  // printed beside it as a second thing somebody could send instead.
  await expect(panel.getByTestId('issued-code-value')).toHaveCount(0)
  await expect(panel.getByRole('button', { name: 'Copy code' })).toHaveCount(0)
  await expect(panel.getByTestId('issued-code-username')).toContainText('demo.fresh.hire')

  // Drawn in the page, from real modules — not an <img> pointed somewhere.
  const qr = panel.getByRole('img', { name: /Demo Fresh Hire/ })
  await expect(qr).toBeVisible()
  expect(await qr.evaluate((node) => node.tagName.toLowerCase())).toBe('svg')
  expect(await qr.evaluate((node) => node.querySelectorAll('path').length)).toBeGreaterThan(0)

  const row = page.getByRole('row', { name: /Demo Fresh Hire/ })
  await expect(row).toContainText('Shawarmania Kalyani')
  await expect(row).toContainText('Shawarmania Kanchrapara')

  await expect(panel.getByRole('button', { name: 'Copy link' })).toBeVisible()
})

test('producing the handover leaves the app origin alone', async ({ page, baseURL }) => {
  const origin = new URL(baseURL ?? E2E_ORIGIN).origin
  const foreign: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== origin) foreign.push(request.url())
  })

  await page.goto('demo/owner/people')
  await page.getByRole('button', { name: 'Add person' }).click()
  await page.getByLabel('Full name').fill('Demo Second Starter')
  await page.getByLabel('Username', { exact: true }).fill('demo.second.starter')
  await page.getByRole('checkbox', { name: 'Shawarmania Kalyani' }).check()
  await page.getByRole('checkbox', { name: 'Shawarmania Kanchrapara' }).check()
  await expect(page.getByLabel('Staff code')).toHaveCount(0)
  await page.getByRole('button', { name: 'Create and issue a code' }).click()

  await expect(page.getByTestId('issued-code')).toBeVisible()
  await expect(page.getByRole('img', { name: /Demo Second Starter/ })).toBeVisible()

  expect(foreign).toEqual([])
})

test('the activation link a real deployment would send resolves to the screen', async ({
  page,
}) => {
  // The one property no unit test can prove: that a URL with a query string,
  // under the deployment's base path, served through the static-hosting
  // fallback, arrives at the activation screen with its code intact.
  await page.goto('activate?code=ABCDE-FGHJK')

  // What the code resolves to depends on whether a backend is reachable, and
  // that is not what this test is about. The assertion is that the route
  // matched under the base path, the screen mounted, and it acted on the code
  // in the URL rather than asking anybody to type one.
  await expect(page.getByLabel('One-time code')).toHaveCount(0)
  await expect(page.getByLabel('Email', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { level: 2 })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible()
})

test('an activation address with no code says so, and offers no field to supply one', async ({
  page,
}) => {
  // The other half of the property above, through the same static-hosting
  // fallback: there is no code-entry path at all now, because the issuing panel
  // hands over a link and a QR and never a raw code
  // (the-root-resolves-instead-of-greeting, D8). An address missing its code is
  // told it is incomplete rather than invited to fill the gap.
  await page.goto('activate')

  await expect(page.getByRole('heading', { name: 'This link is incomplete' })).toBeVisible()
  await expect(page.getByTestId('activate-error')).toContainText('missing its one-time code')
  await expect(page.getByLabel('One-time code')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Continue' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible()
})
