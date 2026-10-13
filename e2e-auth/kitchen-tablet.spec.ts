import { expect, test } from './test'

import {
  TILL_ONE,
  TILL_TWO,
  openKitchen,
  openTill,
  orderCard,
  railSettled,
  ringOrder,
  setSpareKind,
  setSpareTillInService,
} from './tills'

/**
 * #70 the-kitchen-sees-its-orders, end to end on the local stack: a counter
 * tablet and a kitchen tablet, each in its own browser context, meeting only at
 * the server. #72 adds the counter's side: the bell on its card swings until the
 * kitchen presses ACK, and stops when it does. The seed's spare till is turned into a kitchen for the run and
 * put back afterwards — as a billing till, whatever happened in between.
 */

test('a counter rings a kitchen, ACK quiets it, Prepared clears it, and losing sync says so', async ({
  browser,
  request,
}) => {
  test.slow()

  await setSpareTillInService(request, true)
  await setSpareKind(request, 'kitchen')
  const kitchen = await openKitchen(browser, request)
  const counter = await openTill(browser, request, TILL_ONE)

  try {
    const only = async (category: 'Shawarma' | 'Burgers') => {
      await kitchen.page.getByRole('button', { name: /^Filter: / }).click()
      const dialog = kitchen.page.getByRole('dialog')
      await dialog.getByRole('radio', { name: 'Only these' }).click()
      for (const choice of ['Shawarma', 'Burgers']) {
        await dialog
          .getByRole('checkbox', { name: new RegExp(choice, 'i') })
          .setChecked(choice === category)
      }
      await dialog.getByRole('button', { name: 'Save' }).click()
      await expect(kitchen.page.getByTestId('kitchen-filter-summary')).toHaveText(
        `Only ${category}`,
      )
    }
    await only('Shawarma')

    // An order taken at the counter arrives in the kitchen, new and alerting,
    // with no customer anywhere on the kitchen's screen.
    const id = await ringOrder(counter.page, 'Kitchen Sees This')
    const card = kitchen.page.locator(`[data-order-id="${id}"]`)
    await expect(card).toBeVisible({ timeout: 30_000 })
    await expect(card).toHaveAttribute('data-state', 'new')
    await expect(card).toContainText('Classic Chicken Shawarma')
    await expect(kitchen.page.getByText('Kitchen Sees This')).toHaveCount(0)

    // #72: the counter's card carries the kitchen's bell, swinging until the
    // kitchen answers.
    const bell = orderCard(counter.page, id).getByTestId('kitchen-bell')
    await expect(bell).toHaveAttribute('data-ringing', 'true', { timeout: 30_000 })

    // ACK quiets it, and the acknowledgement is the server's.
    await card.getByRole('button', { name: /^ACK order / }).click()
    await expect(card).toHaveAttribute('data-state', 'quiet')
    // The counter hears it through the kitchen pulse, with no reload.
    await expect(bell).not.toHaveAttribute('data-ringing', { timeout: 30_000 })
    await expect(bell).toHaveAccessibleName(`${TILL_TWO.label} has pressed ACK`)
    await kitchen.page.reload()
    await expect(kitchen.page.locator(`[data-order-id="${id}"]`)).toHaveAttribute(
      'data-state',
      'quiet',
    )

    // The owner's sequence: a saved filter changes only the view. Hide the
    // shawarma, then show it again, without a cancellation or another ACK.
    await only('Shawarma')
    await expect(card).toHaveAttribute('data-state', 'quiet')
    await only('Burgers')
    await expect(card).toHaveCount(0)
    await expect(bell).toHaveCount(0)
    await only('Shawarma')
    await expect(card).toHaveAttribute('data-state', 'quiet')
    await expect(card.locator('..')).not.toHaveClass(/kitchen-shake/)
    await expect(card.getByRole('button')).toHaveCount(0)
    await expect(bell).toHaveAccessibleName(`${TILL_TWO.label} has pressed ACK`)

    // Prepared at the counter takes it off the kitchen, with no ACK.
    await railSettled(counter.page)
    await orderCard(counter.page, id).getByRole('button', { name: 'Prepared' }).click()
    await expect(kitchen.page.locator(`[data-order-id="${id}"]`)).toHaveCount(0, {
      timeout: 30_000,
    })

    // Losing the network is said, and said loudly.
    await kitchen.context.setOffline(true)
    await expect(kitchen.page.getByTestId('kitchen-sync-alert')).toBeVisible()
    await kitchen.context.setOffline(false)
    await expect(kitchen.page.getByTestId('kitchen-sync-alert')).toHaveCount(0, {
      timeout: 30_000,
    })
  } finally {
    await kitchen.context.close()
    await counter.context.close()
    await setSpareKind(request, 'counter')
    await setSpareTillInService(request, false)
  }
})
