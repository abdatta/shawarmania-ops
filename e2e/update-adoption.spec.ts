import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { expect, test, type Page } from '@playwright/test'

/**
 * Taking a new build, against a real service worker.
 *
 * The decision rules are pinned as units; what only a browser can prove is the
 * wiring, and the wiring is exactly what shipped broken. vite-plugin-pwa
 * reloads the page itself unless `onNeedReload` is supplied, and the argument
 * this app passed to suppress that has never been read by any version it has
 * depended on. A unit test of our own callbacks stays green through that bug,
 * because our callbacks were never the problem.
 *
 * So these publish a genuine new build: the worker script on disk is given one
 * more byte, which is the whole of what "a new version" means to a browser, and
 * the real chain runs from there — `waiting`, skip-waiting, `controlling`, and
 * the reload that this change intercepts.
 *
 * Interception was the first thing tried and does not work: Playwright can
 * observe the worker-script request but not fulfil it, because the fetch is
 * made by the browser rather than by the page. Hence the file on disk.
 *
 * Mutating a build artefact is safe here by construction. Every test gets its
 * own browser context, so no registration is shared between them; CI runs this
 * suite with a single worker; and the original bytes are restored afterwards.
 */

const updateName = 'Update Shawarmania Ops to the latest version'
const SERVICE_WORKER = fileURLToPath(new URL('../dist/sw.js', import.meta.url))

let originalWorker: string

test.beforeAll(() => {
  originalWorker = readFileSync(SERVICE_WORKER, 'utf8')
})

test.afterAll(() => {
  writeFileSync(SERVICE_WORKER, originalWorker)
})

/** Get to the state a device is in on its second launch: worker active, page controlled. */
async function primeServiceWorker(page: Page) {
  await page.goto('.')
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined))
  await page.reload()
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, {
    timeout: 30_000,
  })
}

/**
 * Publish a build this device has not seen, then have it look.
 *
 * The marker is unique per call so that a second publication within one run is
 * still a difference from the first.
 */
async function publishNewBuild(page: Page, marker: string) {
  writeFileSync(SERVICE_WORKER, `${originalWorker}\n// new build ${marker}\n`)

  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration()
    await registration?.update()
  })
}

/** A value that does not survive a reload, so its absence proves one happened. */
async function markPage(page: Page) {
  await page.evaluate(() => {
    ;(window as Window & { __beforeUpdate?: boolean }).__beforeUpdate = true
  })
}

async function pageSurvived(page: Page) {
  return page.evaluate(
    () => (window as Window & { __beforeUpdate?: boolean }).__beforeUpdate === true,
  )
}

test.describe('adopting a new build', () => {
  test.describe.configure({ mode: 'serial' })

  test('an occupied page is offered the update and is not reloaded', async ({ page }) => {
    await primeServiceWorker(page)

    // Three fields, because two is deliberately under the threshold: a name and
    // a phone number are cheap to retype and must not hold a build back.
    await page.evaluate(() => {
      for (const value of ['one', 'two', 'three']) {
        const field = document.createElement('input')
        field.value = value
        document.body.appendChild(field)
        field.dispatchEvent(new Event('input', { bubbles: true }))
      }
    })
    await markPage(page)

    await publishNewBuild(page, 'occupied')

    await expect(page.getByRole('button', { name: updateName })).toBeVisible({ timeout: 30_000 })
    // The point of the whole change: the running page was left alone.
    expect(await pageSurvived(page)).toBe(true)

    // And it stays left alone, rather than being reloaded a moment later.
    await page.waitForTimeout(5_000)
    expect(await pageSurvived(page)).toBe(true)
  })

  test('an unoccupied page takes the new build by itself', async ({ page }) => {
    await primeServiceWorker(page)
    await markPage(page)

    await publishNewBuild(page, 'unoccupied')

    // The test takes no action: the app reloads once the settle has elapsed.
    await expect.poll(() => pageSurvived(page), { timeout: 30_000 }).toBe(false)
    await expect(page.getByRole('button', { name: updateName })).toHaveCount(0)
  })
})
