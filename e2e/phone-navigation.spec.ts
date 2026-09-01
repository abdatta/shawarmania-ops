import { expect, test } from '@playwright/test'

/**
 * The two-level bottom bar, on a phone (#51).
 *
 * **This spec is the reason the `phone` project exists.** The other two run at
 * tablet and desktop width, where navigation is the rail and its sections are
 * open by default — so every existing e2e spec exercises the rail and none of
 * them has ever drawn the bar. The thing the change was asked for would
 * otherwise ship with unit coverage alone.
 *
 * It walks the demo owner, who reaches the widest set of surfaces in the
 * application: if the bar holds for them without scrolling, it holds.
 */

const BAR = 'nav.fixed'

/**
 * The bottom bar's own top-level entries, by their **visible** labels.
 *
 * A badged tab carries the sr-only sentence a screen reader gets — *"Setup: 10
 * items need you"* — inside it, which is correct and is not what fits on a bar.
 * It is stripped from a clone so the assertion is about what is on screen.
 */
async function topLevel(page: import('@playwright/test').Page) {
  return page.locator(`${BAR} > div:last-child > *`).evaluateAll((nodes) =>
    nodes.map((node) => {
      const clone = node.cloneNode(true) as HTMLElement
      clone.querySelectorAll('.sr-only').forEach((hidden) => hidden.remove())
      return (clone.textContent ?? '').replace(/\d/g, '').trim()
    }),
  )
}

test.beforeEach(async ({ page }) => {
  await page.goto('demo/owner')
  await expect(page.getByTestId('demo-banner')).toBeVisible()
})

test('the owner’s whole navigation fits the bar without scrolling sideways', async ({ page }) => {
  const bar = page.locator(BAR)
  await expect(bar).toBeVisible()

  // The gate, measured rather than counted: every entry is on screen at once.
  const overflow = await bar.evaluate((node) => node.scrollWidth - node.clientWidth)
  expect(overflow, 'the bottom bar scrolls sideways').toBeLessThanOrEqual(1)

  const labels = await topLevel(page)
  expect(labels).toEqual(['Overview', 'Today', 'Finances', 'Attendance', 'Setup'])
})

test('a group opens a card above the bar, anchored to the tab that opened it', async ({ page }) => {
  const setup = page.locator(`${BAR} [data-testid="nav-group-setup"]`)
  await expect(setup).toHaveAttribute('aria-expanded', 'false')

  await setup.click()
  await expect(setup).toHaveAttribute('aria-expanded', 'true')

  // Its children are reachable, and the reader has not moved.
  await expect(page.locator(BAR).getByRole('link', { name: /^Delivery/ })).toBeVisible()
  await expect(page).toHaveURL(/\/demo\/owner$/)

  // The tail sits under Setup — the fifth of five tabs, so nine tenths across.
  const tail = page.getByTestId('nav-card-tail')
  await expect(tail).toBeVisible()
  await expect(tail).toHaveCSS('left', /.+/)

  const [tailCentre, tabCentre] = await Promise.all([
    tail.evaluate((node) => {
      const box = node.getBoundingClientRect()
      return box.left + box.width / 2
    }),
    setup.evaluate((node) => {
      const box = node.getBoundingClientRect()
      return box.left + box.width / 2
    }),
  ])
  expect(Math.abs(tailCentre - tabCentre), 'the tail does not point at its tab').toBeLessThan(2)
})

test('the card sits inside the bar, with no page showing through the gap', async ({ page }) => {
  await page.locator(`${BAR} [data-testid="nav-group-finances"]`).click()

  const gap = await page.evaluate(() => {
    const bar = document.querySelector('nav.fixed')
    const card = bar?.querySelector('.rounded-2xl')
    if (!bar || !card) return null
    // The bar's own block starts at or above the card: nothing of the page can
    // appear between them, because there is no between.
    return card.getBoundingClientRect().top - bar.getBoundingClientRect().top
  })
  expect(gap).not.toBeNull()
  expect(gap!).toBeGreaterThanOrEqual(0)
})

test('a shut group still says what its children are waiting on', async ({ page }) => {
  // Delivery is the only Setup entry with live waiting work, which is what
  // makes its placement there safe.
  const badge = page.locator(`${BAR} [data-testid="nav-group-badge-setup"]`)
  await expect(badge).toBeVisible()
  const sum = Number((await badge.innerText()).replace(/\D.*/s, ''))
  expect(sum).toBeGreaterThan(0)

  await page.locator(`${BAR} [data-testid="nav-group-setup"]`).click()

  // Opening it replaces the sum with the parts. Never both: two numbers
  // describing one queue leave the reader to work out whether they overlap.
  await expect(page.locator(`${BAR} [data-testid="nav-badge-delivery-needs-you"]`)).toContainText(
    String(sum),
  )
  await expect(badge).toHaveCount(0)
})

test('arriving inside a group opens it, and leaving closes it', async ({ page }) => {
  await page.goto('demo/owner/ledger')
  const finances = page.locator(`${BAR} [data-testid="nav-group-finances"]`)
  await expect(finances).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator(BAR).getByRole('link', { name: /^Billing/ })).toBeVisible()

  await page
    .locator(BAR)
    .getByRole('link', { name: /^Overview/ })
    .click()
  await expect(page).toHaveURL(/\/demo\/owner$/)
  await expect(finances).toHaveAttribute('aria-expanded', 'false')
})

test('a group cannot be shut under the reader standing in it', async ({ page }) => {
  await page.goto('demo/owner/ledger')
  const finances = page.locator(`${BAR} [data-testid="nav-group-finances"]`)

  await finances.click()

  // Shutting it would leave them on a Finances page with no sibling row and no
  // way back to one except by tapping again.
  await expect(finances).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator(BAR).getByRole('link', { name: /^Drawer/ })).toBeVisible()
})

test('expanding a group shifts nothing under the reader’s thumb', async ({ page }) => {
  const heading = page.getByRole('heading', { name: 'All outlets' })
  const before = await heading.boundingBox()

  await page.locator(`${BAR} [data-testid="nav-group-setup"]`).click()
  await expect(page.locator(BAR).getByRole('link', { name: /^Menu/ })).toBeVisible()

  const after = await heading.boundingBox()
  expect(after?.y).toBeCloseTo(before?.y ?? 0, 0)
})

test('the bar renders in both themes without a horizontal overflow', async ({ page }, testInfo) => {
  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate((value) => localStorage.setItem('shawarmania.theme', value), theme)
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)

    await page.locator(`${BAR} [data-testid="nav-group-finances"]`).click()
    await expect(page.locator(BAR).getByRole('link', { name: /^Ledger/ })).toBeVisible()

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow, `the page overflows horizontally in ${theme}`).toBeLessThanOrEqual(1)

    await testInfo.attach(`phone-bar-finances-open-${theme}`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
  }
})
