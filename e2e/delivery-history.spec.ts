import { expect, test, type Page } from '@playwright/test'

/**
 * The run history loads as the reader scrolls, in a real browser.
 *
 * **This exists because the component test cannot prove it.** jsdom has no
 * `IntersectionObserver`, so the unit suite stubs one that fires the moment a
 * target is observed — which asserts that a page arrives when asked for, and
 * says nothing about whether anything ever asks. The question "does it fetch
 * everything up front, or a page at a time as I scroll" can only be answered by
 * a browser that actually scrolls, so it is answered here.
 *
 * Two halves, and the first is the one worth having: **arriving must not pull
 * the whole history.** The demo holds well over a hundred runs per channel and
 * the first screen shows a fraction of them; a list that quietly fetched all of
 * them would pass every assertion about what is on screen while doing the exact
 * thing pagination exists to prevent.
 */

async function openDelivery(page: Page) {
  await page.goto('demo/owner/ledger/delivery/zomato')
  await expect(page.getByTestId('demo-banner')).toBeVisible()
  await expect(page.getByTestId('run-history-list')).toBeVisible()
  // The first page has landed once the whole-list placeholder is gone. The
  // sentinel keeps one of its own, so this waits on the list rather than on
  // there being no shimmer anywhere.
  await expect(page.getByTestId('run-history-list').getByTestId('run-read').first()).toBeVisible()
}

/** How many run lines are on screen, collapsed groups counting as one each. */
function rows(page: Page) {
  return page.getByTestId('run-history-list').locator('> div').count()
}

test('the history arrives a page at a time rather than all at once', async ({ page }) => {
  await openDelivery(page)

  const onArrival = await rows(page)

  // A fraction of the history, not the lot. The demo seeds more than a hundred
  // runs per channel and the page size is 25, so an unpaginated list would show
  // several times this.
  expect(onArrival).toBeGreaterThan(0)
  expect(onArrival).toBeLessThan(40)

  // And it says there is more behind it rather than pretending to be the end.
  await expect(page.getByTestId('run-history-more')).toBeAttached()
})

test('scrolling to the end brings the next page, and the list eventually ends', async ({
  page,
}) => {
  await openDelivery(page)
  const onArrival = await rows(page)

  // Scroll to the bottom repeatedly. Each pass should bring another page until
  // the history runs out, at which point the sentinel goes for good — a list
  // that asked forever would never satisfy the second expectation.
  let grew = false
  for (let attempt = 0; attempt < 12; attempt += 1) {
    if ((await page.getByTestId('run-history-more').count()) === 0) break
    await page.mouse.wheel(0, 20_000)
    await page.waitForTimeout(400)
    if ((await rows(page)) > onArrival) grew = true
  }

  expect(grew, 'scrolling to the end never loaded another page').toBe(true)
  expect(await rows(page)).toBeGreaterThan(onArrival)

  // The end is reached by a page coming back short, never by counting the whole
  // history first — so the sentinel disappears rather than spinning.
  await expect(page.getByTestId('run-history-more')).toHaveCount(0)
  await expect(page.getByTestId('run-history-cut-off')).toBeVisible()
})
