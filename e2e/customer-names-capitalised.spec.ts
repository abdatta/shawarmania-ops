import type { Locator, Page } from '@playwright/test'

import { expect, test } from './test'

/**
 * A new customer's name capitalised in the counter's name field as each word is
 * finished (a-customer-name-is-capitalised, task 3.5). Every assertion holds
 * only with `customer-names-capitalised` on.
 *
 * Typed key by key, as a hardware keyboard types, because the field corrects a
 * word at the space after it and at a pause, and a `fill` is one paste. **The
 * cursor never moves** [owner, 2026-11-23], so where a test types on after a
 * correction it reads the caret after every key.
 */

const ON = { tag: '@cg-on:customer-names-capitalised' }

/** Longer than the field's pause, with room for a slow runner. */
const PAST_THE_PAUSE_MS = 1_300

const DISH = 'Classic Chicken Shawarma'

/** Ten digits nobody in the demo's directory has, so each asks for a name. */
let nextNumber = 9_123_400_000

async function openCounter(page: Page) {
  await page.goto('demo/biller')
  await expect(page.getByRole('heading', { name: 'Counter tablet' })).toBeVisible()
}

/** Rings the dish, opens the customer box and keys a new number into it. */
async function newCustomerBox(page: Page): Promise<{ dialog: Locator; field: Locator }> {
  await page.getByRole('button', { name: DISH, exact: true }).click()
  await page.getByTestId('customer-row').click()
  const dialog = page.getByRole('dialog', { name: 'Customer' })
  for (const digit of String((nextNumber += 1))) {
    await dialog.getByRole('button', { name: digit, exact: true }).click()
  }
  const field = dialog.getByPlaceholder('Enter New Customer’s Name')
  await expect(field).toBeVisible()
  await field.click()
  return { dialog, field }
}

/** Where the caret is, and whether anything is selected. */
async function caret(field: Locator) {
  return field.evaluate((input: HTMLInputElement) => ({
    start: input.selectionStart,
    end: input.selectionEnd,
    length: input.value.length,
  }))
}

/** Types one key at a time, reading the caret after each: it sits after the key. */
async function typeWatchingTheCaret(page: Page, field: Locator, text: string, from: number) {
  let at = from
  for (const key of text) {
    await page.keyboard.type(key)
    at += 1
    expect(await caret(field)).toMatchObject({ start: at, end: at })
  }
}

test.describe('a new customer’s name is capitalised in the box', () => {
  test.beforeEach(async ({ page }) => {
    await openCounter(page)
  })

  test(
    'rahul das typed key by key reads Rahul Das, and is saved and billed so',
    ON,
    async ({ page }) => {
      const { dialog, field } = await newCustomerBox(page)

      await field.pressSequentially('rahul das', { delay: 40 })
      await expect(field).toHaveValue('Rahul Das')
      // No line, no button: the box is the field and its pad.
      await expect(dialog.getByText(/saves as|keep as typed/i)).toHaveCount(0)

      await dialog.getByTestId('customer-confirm').click()
      await expect(dialog).toHaveCount(0)
      await expect(page.getByTestId('customer-row')).toContainText('Rahul Das ·')

      // The demo's Kalyani asks how each order is served before it is sent.
      const takeaway = page.getByTestId('service-chip-takeaway')
      if (await takeaway.isVisible()) await takeaway.click()

      // Saved as an order: its card is the one the rail did not hold before.
      const rail = page.getByTestId('counter-activity-rail')
      const ids = () =>
        rail
          .locator('[data-flip-id]')
          .evaluateAll((els) => els.map((el) => el.getAttribute('data-flip-id')!))
      const before = new Set(await ids())
      await page.getByTestId('save-order').click()
      let added: string[] = []
      await expect
        .poll(async () => (added = (await ids()).filter((id) => !before.has(id))).length)
        .toBe(1)
      const card = rail.locator(`[data-flip-id="${added[0]}"]`)

      // The card keeps its customer behind More actions, as a ticket should.
      await card.getByRole('button', { name: /^More actions for / }).click()
      await page.getByRole('menuitem', { name: 'Customer', exact: true }).click()
      const details = page.getByRole('dialog', { name: /^Customer for / })
      await expect(details).toContainText('Rahul Das')
      await page.keyboard.press('Escape')
      await expect(details).toHaveCount(0)

      // Paid on the card, then prepared, so it settles into Bills this shift.
      const bills = page.getByRole('region', { name: 'Bills this shift' }).locator('details')
      const billsBefore = await bills.count()
      await card.getByRole('button', { name: 'Paid', exact: true }).click()
      const payment = page.getByRole('dialog', { name: 'Record payment' })
      await payment.getByRole('button', { name: 'Cash', exact: true }).click()
      await payment.getByRole('button', { name: 'Paid', exact: true }).click()
      await expect(payment).toHaveCount(0)
      await card.getByRole('button', { name: `Tick 1 ${DISH}`, exact: true }).click()
      await expect(bills).toHaveCount(billsBefore + 1)

      // The bill carries the name the box saved.
      const bill = bills.first()
      if ((await bill.getAttribute('open')) === null) await bill.locator('summary').click()
      await expect(bill).toContainText('Rahul Das')
    },
  )

  test('going back over SANJAY keeps SANJAY', ON, async ({ page }) => {
    const { dialog, field } = await newCustomerBox(page)

    await field.pressSequentially('SANJAY', { delay: 40 })
    await expect(field).toHaveValue('Sanjay')
    for (let i = 0; i < 5; i += 1) await page.keyboard.press('Backspace')
    await field.pressSequentially('ANJAY', { delay: 40 })
    await page.waitForTimeout(PAST_THE_PAUSE_MS)
    await expect(field).toHaveValue('SANJAY')

    await dialog.getByTestId('customer-confirm').click()
    await expect(page.getByTestId('customer-row')).toContainText('SANJAY ·')
  })

  test(
    'a pause then more typing reads Rahul Das, the caret at the end throughout',
    ON,
    async ({ page }) => {
      const { field } = await newCustomerBox(page)

      await typeWatchingTheCaret(page, field, 'rahul', 0)
      await expect(field).toHaveValue('Rahul')
      expect(await caret(field)).toEqual({ start: 5, end: 5, length: 5 })

      await typeWatchingTheCaret(page, field, ' das', 5)
      await expect(field).toHaveValue('Rahul Das')
      expect(await caret(field)).toEqual({ start: 9, end: 9, length: 9 })
    },
  )

  test('a letter typed back inside Rahul Das lands exactly there', ON, async ({ page }) => {
    const { field } = await newCustomerBox(page)

    await field.pressSequentially('rahul das', { delay: 40 })
    await expect(field).toHaveValue('Rahul Das')
    // Back to between `Rahul` and the space.
    for (let i = 0; i < 4; i += 1) await page.keyboard.press('ArrowLeft')
    expect(await caret(field)).toMatchObject({ start: 5, end: 5 })

    await page.keyboard.type('s')
    await expect(field).toHaveValue('Rahuls Das')
    expect(await caret(field)).toMatchObject({ start: 6, end: 6 })
    await page.waitForTimeout(PAST_THE_PAUSE_MS)
    await expect(field).toHaveValue('Rahuls Das')
    expect(await caret(field)).toMatchObject({ start: 6, end: 6 })
  })
})
