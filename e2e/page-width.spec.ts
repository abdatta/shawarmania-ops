import { type Page } from '@playwright/test'
import { expect, test } from './test'

/**
 * Every page an owner, a manager or a staff member reaches from the rail keeps
 * to one column on a wide screen (owner-pages-share-one-width).
 *
 * Each surface caps its own width, so a new page that forgets to is wide on
 * desktop and looks right on the phone it was built on — Billing ran edge to
 * edge for weeks that way. The pages are read from the rail rather than listed
 * here, so the next page is checked without anyone remembering to add it.
 *
 * What is measured is the content itself — every line of text and every field,
 * picture and chart — not a wrapper, which may be full width and empty.
 */

/** `max-w-2xl`: the one column every page uses. */
const STANDARD = 672
/** `max-w-5xl`: Analytics, whose charts and bars read better with the room. */
const ANALYTICS = 1024

const SHELLS = ['owner', 'admin', 'staff'] as const

async function contentWidth(page: Page): Promise<number> {
  return page.evaluate(() => {
    const main = document.querySelector('main')
    if (!main) return 0
    let left = Infinity
    let right = -Infinity
    // A table that scrolls sideways shows only its scroller's width; what is
    // scrolled out of view is not on the page.
    const take = (rect: DOMRect, from: Element | null) => {
      if (rect.width === 0 || rect.height === 0) return
      let l = rect.left
      let r = rect.right
      for (let at = from; at && at !== main; at = at.parentElement) {
        if (getComputedStyle(at).overflowX === 'visible') continue
        const box = at.getBoundingClientRect()
        l = Math.max(l, box.left)
        r = Math.min(r, box.right)
      }
      if (r <= l) return
      left = Math.min(left, l)
      right = Math.max(right, r)
    }
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim()) continue
      const range = document.createRange()
      range.selectNodeContents(node)
      take(range.getBoundingClientRect(), node.parentElement)
    }
    main.querySelectorAll('input, select, textarea, img, svg, canvas').forEach((element) => {
      take(element.getBoundingClientRect(), element)
    })
    return right > left ? right - left : 0
  })
}

for (const shell of SHELLS) {
  test(`every ${shell} page keeps to one column on a wide screen`, async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 })
    await page.goto(`demo/${shell}`)
    const rail = page.getByRole('navigation', { name: 'Primary' })
    await expect(rail.getByRole('link').first()).toBeVisible()
    const hrefs = await rail
      .getByRole('link')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''))
    expect(hrefs.length).toBeGreaterThan(1)

    for (const href of new Set(hrefs)) {
      await page.goto(href.replace(/^\/[^/]+\//, ''))
      await page.locator('main h1, main h2').first().waitFor()
      // Reads settle after the heading; a row that arrives late is still content.
      await page.waitForLoadState('networkidle')
      const limit = /\/analytics\//.test(href) ? ANALYTICS : STANDARD
      expect(await contentWidth(page), `${href} content width`).toBeLessThanOrEqual(limit)
    }
  })
}
