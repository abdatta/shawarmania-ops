import { expect, test } from '@playwright/test'

// baseURL carries the deployment sub-path, so every goto here is relative.

/**
 * Change gates in the demo (a-release-can-be-switched-off, D15, D16, D18):
 * reached by its address and nothing else, every gate on to begin with, a turn
 * taking effect at once with the demo's data kept, a gate turned off with the
 * gate it depends on, and a reset putting everything back on. The build stamp
 * opens the build code while anything is on.
 */

test('the demo’s Change gates opens from its address, and nothing links to it', async ({
  page,
}) => {
  await page.goto('demo/owner/change-gates')
  await expect(page.getByTestId('change-gate-list')).toBeVisible()
  await expect(page.getByTestId('open-gate-probe')).toContainText('Probe')
  await expect(page.getByTestId('depends-kitchen-ready')).toContainText('Dependent on DT')
  await expect(page.getByRole('link', { name: 'Change gates', exact: true })).toHaveCount(0)
  await page.getByTestId('build-version').click()
  await expect(page.getByTestId('build-code')).toHaveText(/^[0-9a-f]+·PB-TH$/)
})

test('turning the probe off and on changes the build stamp at once, and a reset restores it', async ({
  page,
}) => {
  await page.goto('demo/owner/change-gates/probe')
  const codeAfterOpening = async () => {
    await page.getByTestId('build-version').click()
    const code = await page.getByTestId('build-code').textContent()
    await page.getByRole('button', { name: 'Close' }).click()
    return code
  }
  expect(await codeAfterOpening()).toMatch(/·PB-TH$/)

  await page.getByRole('switch', { name: 'Turn off Probe' }).click()
  await page.getByTestId('turn-reason').fill('Comparing the two')
  await page.getByTestId('confirm-turn-submit').click()

  await expect(page.getByTestId('gate-since')).toContainText(/^Off/)
  expect(await codeAfterOpening()).toMatch(/·TH$/)
  await expect(page.getByTestId('gate-history').getByRole('listitem').first()).toContainText(
    'Comparing the two',
  )

  // The turn outlives a demo reload in this tab, with its line in the history…
  await page.reload()
  await expect(page.getByTestId('gate-since')).toContainText(/^Off/)
  await expect(page.getByTestId('gate-history').getByRole('listitem').first()).toContainText(
    'Comparing the two',
  )
  expect(await codeAfterOpening()).toMatch(/·TH$/)

  // …and a reset is the starting scenario, which has every gate on.
  await page.getByTestId('demo-reset').click()
  await page.getByRole('button', { name: 'Discard and start again' }).click()
  await expect(page.getByTestId('gate-since')).toContainText(/^On/)
  expect(await codeAfterOpening()).toMatch(/·PB-TH$/)
})

test('turning a gate off turns off the gates that depend on it', async ({ page }) => {
  await page.goto('demo/owner/change-gates/dish-ticks')
  await page.getByTestId('turn-gate').click()
  await expect(page.getByTestId('turn-also-off')).toContainText('Kitchen Ready')
  await page.getByTestId('confirm-turn-submit').click()
  await expect(page.getByTestId('gate-since')).toContainText(/^Off/)

  await page.goto('demo/owner/change-gates/kitchen-ready')
  await expect(page.getByTestId('gate-since')).toContainText(/^Off/)
  await expect(page.getByTestId('turn-gate')).toBeDisabled()
})

for (const [where, path] of [
  ['the counter', 'demo/biller'],
  ['the kitchen', 'demo/kitchen'],
] as const) {
  test(`${where} shows the running build at the foot of the screen`, async ({ page }) => {
    await page.goto(path)
    await expect(page.getByTestId('build-version')).toContainText(/Build \S+/)
  })
}

test('an everyday phone page has no stamp at its foot: the account menu carries it', async ({
  page,
}) => {
  await page.goto('demo/owner')
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()
  await expect(page.getByTestId('build-version')).toHaveCount(0)
})
