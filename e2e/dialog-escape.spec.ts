import { expect, test } from '@playwright/test'

/**
 * Every dialog in this app can be dismissed from the keyboard.
 *
 * The claim is a requirement in more than one spec, it is free as long as
 * `src/components/ui/modal.tsx` keeps using the native `<dialog>` element, and it
 * silently stops being true the moment anything reaches for a div instead. That
 * combination is exactly what a test is for.
 *
 * **This spec exists because the cheaper check was not a fair one.** Driving the
 * app through the in-app automated browser on 2026-08-17, a synthetic Escape
 * reached the page — a document listener counted it — and the open dialog stayed
 * open. So did a bare `<dialog>` injected into the same page with no React near
 * it, which received no `cancel` event at all. That rules the app out: nothing
 * sat between the key and the dialog in that probe. What it does not do is prove
 * the behaviour works for a person, because a harness that cannot deliver a
 * user-agent-level Escape cannot demonstrate one either.
 *
 * Playwright drives real input through the browser itself, so it can. Anybody
 * who finds Escape apparently broken while automating this app should read the
 * result here before chasing it.
 */

test.describe('dialogs close from the keyboard', () => {
  test('Escape closes a confirmation, leaving the action untaken', async ({ page }) => {
    await page.goto('demo/owner')

    // The demo banner's own confirmation, chosen because it is on every demo
    // screen and belongs to no feature: a failure here is the shared Modal's,
    // not one surface's.
    await page.getByRole('button', { name: 'Start again' }).click()

    const dialog = page.getByRole('dialog', { name: /start the demo again/i })
    await expect(dialog).toBeVisible()

    await page.keyboard.press('Escape')

    await expect(dialog).toBeHidden()

    // Dismissing is not confirming. A dialog that closed and ran its action
    // anyway would pass a visibility assertion and be a far worse bug than one
    // that would not close at all.
    await expect(page.getByRole('button', { name: 'Start again' })).toBeVisible()
  })

  test('a bare native dialog closes too, which is what the shared Modal relies on', async ({
    page,
  }) => {
    await page.goto('demo/owner')

    // The platform behaviour itself, with nothing of ours involved. If this ever
    // fails, the assumption `Modal` is built on has changed and the component
    // needs its own Escape handling rather than the element's.
    await page.evaluate(() => {
      const probe = document.createElement('dialog')
      probe.id = 'escape-probe'
      probe.textContent = 'probe'
      document.body.appendChild(probe)
      probe.showModal()
    })

    await expect(page.locator('#escape-probe')).toHaveJSProperty('open', true)
    await page.keyboard.press('Escape')
    await expect(page.locator('#escape-probe')).toHaveJSProperty('open', false)
  })
})
