import type { Page } from '@playwright/test'

import { expect, test } from './test'

/**
 * A tap on the dimmed space outside a pop-up
 * (a-popup-closes-when-you-tap-outside-it, change gate `outside-tap-closes`).
 *
 * These use a real mouse on a real backdrop in a real browser, because the
 * claims worth proving are about where the browser reports a click: on the
 * backdrop and on a dialog's own padding the target is the same element, and a
 * press that begins inside a field and ends outside reports its click on the
 * dialog too. A jsdom test pins the arithmetic; only this shows the browser
 * agrees with it.
 *
 * The pop-up ignores a tap for its first 400 ms (the second tap of a double-tap
 * on the button that opened it), so each test waits that out before aiming at
 * the backdrop. That is the one wait in the file and it is the thing under test.
 */

const AFTER_THE_GRACE_MS = 450

async function openStartAgain(page: Page) {
  await page.goto('demo/owner')
  await page.getByRole('button', { name: 'Start again' }).click()
  const dialog = page.getByRole('dialog', { name: /start the demo again/i })
  await expect(dialog).toBeVisible()
  await page.waitForTimeout(AFTER_THE_GRACE_MS)
  return dialog
}

async function openAddPerson(page: Page) {
  await page.goto('demo/owner/team')
  await page.getByRole('button', { name: 'Add person' }).click()
  const sheet = page.getByRole('dialog', { name: 'Add person' })
  await expect(sheet).toBeVisible()
  await page.waitForTimeout(AFTER_THE_GRACE_MS)
  return sheet
}

test.describe('tapping outside a pop-up', () => {
  test(
    'closes a confirmation without taking its action',
    { tag: '@cg-on:outside-tap-closes' },
    async ({ page }) => {
      const dialog = await openStartAgain(page)

      await page.mouse.click(4, 4)

      await expect(dialog).toBeHidden()
      // Dismissing is not confirming: the demo was not reset, so its banner is
      // still there to start it again from.
      await expect(page.getByRole('button', { name: 'Start again' })).toBeVisible()
    },
  )

  test(
    'does nothing with the gate off, as before, and Escape still closes it',
    { tag: '@cg-off:outside-tap-closes' },
    async ({ page }) => {
      const dialog = await openStartAgain(page)

      await page.mouse.click(4, 4)
      await expect(dialog).toBeVisible()

      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
    },
  )

  test(
    'leaves a confirmation open when the tap lands on its own padding',
    { tag: '@cg-on:outside-tap-closes' },
    async ({ page }) => {
      const dialog = await openStartAgain(page)
      const box = (await dialog.boundingBox())!

      // Half-way down the left edge, inside the border and left of any text:
      // the browser reports a click here on the dialog, as it does on the backdrop.
      await page.mouse.click(box.x + 6, box.y + box.height / 2)

      await expect(dialog).toBeVisible()
    },
  )

  test(
    'closes a sheet, and keeps it when a press starts in a field and ends outside',
    { tag: '@cg-on:outside-tap-closes' },
    async ({ page }) => {
      const sheet = await openAddPerson(page)
      const field = sheet.getByRole('textbox').first()
      const box = (await field.boundingBox())!

      // Selecting text and letting go past the edge: the click is reported on
      // the dialog, outside its rectangle.
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      await page.mouse.move(4, 4, { steps: 6 })
      await page.mouse.up()
      await expect(sheet).toBeVisible()

      await page.mouse.click(4, 4)
      await expect(sheet).toBeHidden()
    },
  )

  test(
    'closes a phone’s sheet from the strip of screen it leaves uncovered',
    { tag: '@cg-on:outside-tap-closes' },
    async ({ page }) => {
      await page.setViewportSize({ width: 412, height: 915 })
      const sheet = await openAddPerson(page)
      const box = (await sheet.boundingBox())!

      // A sheet holds at most 85% of the screen's height and spans its width, so
      // the only backdrop on a phone is the strip above or below it: aim at the
      // middle of the bigger one, whichever edge the sheet hangs from.
      const above = box.y
      const below = 915 - (box.y + box.height)
      expect(Math.max(above, below)).toBeGreaterThan(40)
      await page.mouse.click(206, above > below ? above / 2 : box.y + box.height + below / 2)

      await expect(sheet).toBeHidden()
    },
  )
})
