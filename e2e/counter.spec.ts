import { expect, test, type Page } from '@playwright/test'

/**
 * The counter, in a real browser, on the device it actually runs on.
 *
 * The gate for `ui-billing-counter` is three clauses and each has a test here:
 * a full order rung and settled on a tablet viewport, the whole menu visible
 * without scrolling, and the UI-only customer-name-or-phone gate.
 *
 * The offline spec is the other half — the sync indicator's three states are the
 * whole reason it exists, and the escalated one cannot be reached by looking at
 * a screenshot.
 *
 * baseURL carries the deployment sub-path, so every goto is relative.
 */

async function setTheme(page: Page, theme: 'light' | 'dark') {
  await page.evaluate((value) => {
    localStorage.setItem('shawarmania.theme', value)
  }, theme)
}

async function recordPaid(page: Page, method = 'Cash') {
  const name = page.getByPlaceholder('Customer name')
  const phone = page.getByPlaceholder('Phone number')
  if (!(await name.inputValue()).trim() && !(await phone.inputValue()).trim()) {
    await name.fill('Test customer')
  }
  await page.getByTestId('settle').click()
  const dialog = page.getByRole('dialog', { name: 'Record payment' })
  await dialog.getByRole('button', { name: method, exact: true }).click()
  await dialog.getByRole('button', { name: 'Paid', exact: true }).click()
}

test.describe('the counter', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('demo/biller')
  })

  test('lands on the counter with a shift already open', async ({ page }) => {
    await expect(page).toHaveURL(/\/demo\/biller\/billing$/)
    await expect(page.getByTestId('shift-status')).toContainText('Demo Biller')
    await expect(page.getByTestId('sync-indicator')).toHaveAttribute('data-sync', 'pending')
    await expect(page.getByTestId('sync-indicator')).toContainText('1 pending')
  })

  test('shows the whole menu without scrolling on a tablet', async ({ page }) => {
    // The smallest tablet this is designed for. If a menu item is ever added
    // that pushes the grid past one screen, this fails rather than a shift does.
    await page.setViewportSize({ width: 1024, height: 768 })
    const grid = page.getByTestId('menu-grid')
    await expect(grid).toBeVisible()

    const fits = await grid.evaluate((node) => node.scrollHeight <= node.clientHeight)
    expect(fits).toBe(true)

    // And every item really is on it, including the one that is off today.
    await expect(grid.getByRole('button')).toHaveCount(7)
  })

  test('records a full bill through the tap-first payment dialog', async ({ page }) => {
    await page.getByRole('button', { name: 'Classic Chicken Shawarma', exact: true }).click()
    await page.getByRole('button', { name: 'Classic Chicken Shawarma', exact: true }).click()
    await page.getByRole('button', { name: 'Mozzarella Cheese Chicken Shawarma' }).click()
    await page.getByRole('button', { name: 'Fully Loaded Smashed Burger' }).click()

    // 139×2 + 199 + 250
    await expect(page.getByTestId('bill-total')).toHaveText('₹727')

    await recordPaid(page)

    // Cleared for the next customer, immediately: the composer gives way and
    // the money list it serves is what shows through. No bar is inserted —
    // the queued bill is the whole acknowledgement.
    await expect(page.getByRole('heading', { name: 'Bills this shift' })).toBeVisible()
    await expect(page.getByTestId('settled-confirmation')).toHaveCount(0)
    await expect(
      page.getByTestId('bill-column').locator('details').filter({ hasText: '₹727' }),
    ).toBeVisible()
  })

  test('requires either customer name or phone before Order or Paid', async ({ page }) => {
    await page.getByRole('button', { name: 'Classic Chicken Shawarma', exact: true }).click()
    await expect(page.getByPlaceholder('Customer name')).toHaveValue('')
    await expect(page.getByPlaceholder('Phone number')).toHaveValue('')
    await expect(page.getByRole('button', { name: 'Order', exact: true })).toBeDisabled()
    await expect(page.getByTestId('settle')).toBeDisabled()
    await expect(page.getByTestId('settle')).toHaveText('Paid')
    await expect(page.getByText('Add a customer name or phone to continue.')).toBeVisible()

    await page.getByPlaceholder('Phone number').fill('9000000000')
    await expect(page.getByRole('button', { name: 'Order', exact: true })).toBeEnabled()
    await expect(page.getByTestId('settle')).toBeEnabled()
    await expect(page.getByTestId('save-order')).toHaveClass(/bg-primary/)
    await expect(page.getByTestId('settle')).toHaveClass(/bg-surface/)
  })

  test('keeps the bill until payment allocations exactly cover it', async ({ page }) => {
    await page.getByRole('button', { name: 'Classic Chicken Shawarma', exact: true }).click()
    await page.getByPlaceholder('Customer name').fill('Demo Regular')
    await page.getByTestId('settle').click()

    const dialog = page.getByRole('dialog', { name: 'Record payment' })
    await expect(dialog.getByRole('heading', { name: 'Record payment' })).toBeFocused()
    const cashClass = await dialog
      .getByRole('button', { name: 'Cash', exact: true })
      .getAttribute('class')
    await expect(dialog.getByRole('button', { name: 'UPI', exact: true })).toHaveAttribute(
      'class',
      cashClass!,
    )
    await expect(dialog.getByRole('button', { name: 'Paid', exact: true })).toBeDisabled()
    await expect(page.getByTestId('bill-total')).toHaveText('₹139')
    await expect(page.getByTestId('settled-confirmation')).toHaveCount(0)
  })

  test('will not sell an item that is off the menu', async ({ page }) => {
    const off = page.getByRole('button', {
      name: 'Stuffed Lebanese Chicken Shawarma — off the menu',
    })
    await expect(off).toBeVisible()
    await expect(off).toBeDisabled()
  })

  test('edits an immediate payment beside the paid bill', async ({ page }) => {
    await page.getByRole('button', { name: 'Mayonnaise Chicken Shawarma' }).click()
    await page.getByPlaceholder('Customer name').fill('Demo Regular')
    await recordPaid(page)

    await expect(page.getByTestId('undo-settle')).toHaveCount(0)
    const paidBill = page.locator('details').filter({
      has: page.locator('summary').filter({ hasText: 'Cash' }).filter({ hasText: '₹159' }),
    })
    await paidBill.locator('summary').click()
    await paidBill.getByRole('button', { name: /^Edit \(\d+ min\)$/ }).click()
    const edit = page.getByRole('dialog', { name: 'Record payment' })
    await expect(edit.getByRole('heading', { name: 'Edit payment' })).toBeVisible()
    await edit.getByRole('button', { name: 'Remove Cash payment' }).click()
    await edit.getByRole('button', { name: 'UPI', exact: true }).click()
    await edit.getByRole('button', { name: 'Save payment' }).click()
    await expect(page.getByText('Payment updated.')).toBeVisible()

    const correctedBill = page.locator('details').filter({
      has: page.locator('summary').filter({ hasText: 'UPI' }).filter({ hasText: '₹159' }),
    })
    if ((await correctedBill.getAttribute('open')) === null) {
      await correctedBill.locator('summary').click()
    }
    await correctedBill.getByRole('button', { name: 'Demo: 59 sec' }).click()
    await expect(correctedBill.getByRole('button', { name: /^Edit \(5\d sec\)$/ })).toBeVisible()
    await correctedBill.getByRole('button', { name: 'Demo: expire' }).click()
    await expect(correctedBill.getByRole('button', { name: /^Edit \(/ })).toHaveCount(0)

    // Long settled: the composer never came back after the payment.
    await expect(page.getByRole('heading', { name: 'Bills this shift' })).toBeVisible()
    await expect(page.getByTestId('bill-total')).toHaveCount(0)
  })

  test('saves and records a food-first order from the persistent rail', async ({ page }) => {
    await page.getByRole('button', { name: 'Classic Chicken Shawarma', exact: true }).click()
    await page.getByRole('button', { name: 'Mayonnaise Chicken Shawarma', exact: true }).click()
    await page.getByPlaceholder('Customer name').fill('Asha')
    await page.getByTestId('save-order').click()
    await expect(page.getByTestId('saved-order-confirmation')).toHaveCount(0)

    const rail = page.getByTestId('counter-activity-rail')
    // Before delivery the card carries a local reference, never a number — and
    // no per-line prices: the total is what the pipeline card shows.
    const saved = rail.getByTestId(/^open-order-local-/)
    await expect(saved.getByText('Asha', { exact: true })).toBeVisible()
    await expect(saved.getByText('Classic Chicken Shawarma', { exact: true })).toBeVisible()
    await expect(saved.getByText('Mayonnaise Chicken Shawarma', { exact: true })).toBeVisible()
    await expect(saved.getByText(/^Local · [0-9A-Z]{4}$/)).toBeVisible()
    await expect(saved.getByText('now', { exact: true })).toBeVisible()
    await expect(saved.getByText('Demo Biller', { exact: true })).toHaveCount(0)
    await expect(saved).toContainText('₹298')

    // The section's next step is preparation, not money.
    await saved.getByRole('button', { name: 'Prepared', exact: true }).click()
    const preparedCard = rail
      .getByTestId('pipeline-unpaid-prepared')
      .getByTestId(/^open-order-local-/)
    await expect(preparedCard).toBeVisible()
    // Green is the unpaid-prepared band's identity, and Reprepare is a visible
    // secondary beside the green Paid.
    const greenPaid = preparedCard.getByRole('button', { name: 'Paid', exact: true })
    await expect(greenPaid).toHaveClass(/bg-success/)
    await expect(preparedCard.getByRole('button', { name: 'Reprepare', exact: true })).toBeVisible()

    // And then the money, which flies left into Bills this shift. The dialog
    // confirm is the only remaining Mark-Paid-family label — and it reads Paid.
    await greenPaid.click()
    const payment = page.getByRole('dialog', { name: 'Record payment' })
    await payment.getByRole('button', { name: 'UPI', exact: true }).click()
    await payment.getByRole('button', { name: 'Paid', exact: true }).click()

    const shiftBills = page.getByRole('region', { name: 'Bills this shift' })
    const closed = shiftBills
      .locator('details')
      .filter({ hasText: 'Mayonnaise Chicken Shawarma' })
      .filter({ hasText: 'Asha' })
    await expect(closed).toBeVisible()
    await expect(closed.getByLabel('Payment editable')).toBeVisible()
    await closed.locator('summary').click()
    await expect(closed.getByRole('button', { name: /^Edit \(5 min\)$/ })).toBeVisible()
    await expect(closed).toContainText('UPI')
    await expect(closed).toContainText('Classic Chicken Shawarma')
    await expect(closed).toContainText('Mayonnaise Chicken Shawarma')
    await expect(closed).toContainText('1 × ₹139')
  })

  test('pays a preparing order straight away and settles it only when prepared', async ({
    page,
  }) => {
    const rail = page.getByTestId('counter-activity-rail')
    const preparing = rail.getByTestId('pipeline-preparing')
    // 105 is the seed that is still preparing; 104 stands in Unpaid Prepared.
    const order = preparing.getByTestId('open-order-105')

    // Both next steps sit on the face of the card: preparation and money.
    await expect(order.getByRole('button', { name: 'Prepared', exact: true })).toBeVisible()
    await expect(order.getByRole('button', { name: 'Paid', exact: true })).toBeVisible()

    // Money first, food still owed: no bill exists, so nothing may land in
    // Bills this shift and no bar may be inserted. The PAID chip is the whole
    // acknowledgement.
    const billColumn = page.getByTestId('bill-column')
    await expect(billColumn.locator('details').first()).toBeVisible()
    const billsBefore = await billColumn.locator('details').count()
    await order.getByRole('button', { name: 'Paid', exact: true }).click()
    const payment = page.getByRole('dialog', { name: 'Record payment' })
    await payment.getByRole('button', { name: 'Cash', exact: true }).click()
    await payment.getByRole('button', { name: 'Paid', exact: true }).click()

    await expect(page.locator('dialog[open]')).toHaveCount(0)
    await expect(page.getByTestId('settled-confirmation')).toHaveCount(0)
    const paidCard = preparing.getByTestId('open-order-105')
    await expect(paidCard).toBeVisible()
    await expect(paidCard).toHaveAttribute('data-paid', 'true')
    await expect(billColumn.locator('details')).toHaveCount(billsBefore)

    // Preparation was the last thing the bill waited for.
    await paidCard.getByRole('button', { name: 'Prepared', exact: true }).click()
    await expect(rail.getByTestId('open-order-105')).toHaveCount(0)
    await expect(billColumn.locator('details')).toHaveCount(billsBefore + 1)
  })

  test('colour-codes the bands, keeps the divider as their only words, and reprepares', async ({
    page,
  }) => {
    const rail = page.getByTestId('counter-activity-rail')

    // No headings anywhere in the rail; the labelled divider is the only words
    // between the two bands.
    await expect(rail.getByRole('heading')).toHaveCount(0)
    await expect(rail.getByText('Prepared · awaiting money')).toBeVisible()

    // The green band's Paid is a filled success action, and Reprepare stands
    // beside it as a visible secondary rather than hiding in the overflow.
    const preparedBand = rail.getByTestId('pipeline-unpaid-prepared')
    const greenPaid = preparedBand.getByRole('button', { name: 'Paid', exact: true })
    await expect(greenPaid).toHaveClass(/bg-success/)
    await expect(greenPaid).toHaveClass(/text-on-success/)
    const preparedCard = preparedBand.getByTestId(/^open-order/).first()
    const reprepare = preparedCard.getByRole('button', { name: 'Reprepare', exact: true })
    await expect(reprepare).toBeVisible()
    await expect(preparedCard.getByRole('menuitem', { name: 'Reprepare' })).toHaveCount(0)

    // Reprepare carries it back up into Preparing.
    const testid = await preparedCard.getAttribute('data-testid')
    await reprepare.click()
    await expect(rail.getByTestId('pipeline-preparing').getByTestId(testid!)).toBeVisible()
    await expect(preparedBand.getByTestId(testid!)).toHaveCount(0)
  })

  test('edits an order in the full composer and restores the waiting draft', async ({ page }) => {
    await page.getByRole('button', { name: 'Classic Chicken Shawarma', exact: true }).click()
    await page.getByPlaceholder('Customer name').fill('Waiting customer')

    const rail = page.getByTestId('counter-activity-rail')
    const order = rail.getByTestId('open-order-104')
    // Uncommon actions live behind the touch-safe kebab.
    await order.getByRole('button', { name: /^More actions for Order .104$/ }).click()
    await order.getByRole('menuitem', { name: 'Edit' }).click()
    await expect(page.getByRole('heading', { name: 'Editing order #104' })).toBeVisible()

    // The mode is spatial, not just labelled: the order leaves the list and its
    // card docks against the current-bill column, touching it, so the two read
    // as one surface. Assert the geometry, because that join is the whole point
    // and a stylesheet change can undo it while every text assertion stays green.
    const pin = rail.getByTestId('editing-order-pin')
    await expect(pin).toContainText('Order')
    await expect(order).toHaveCount(0)

    // The composer footer moved into the card rather than being duplicated: one
    // Save changes, one set of customer fields, and no second total or item list.
    await expect(pin.getByTestId('save-order')).toBeVisible()
    await expect(pin.getByTestId('cancel-edit')).toBeVisible()
    await expect(page.getByPlaceholder('Customer name')).toHaveCount(1)
    await expect(pin.getByTestId('bill-total')).toHaveCount(0)
    await expect(pin.getByRole('list', { name: /Items for order/ })).toHaveCount(0)

    // The card's left edge meets the panel's right edge, within a pixel either
    // way. That join is the whole point of the dock, and a stylesheet change can
    // undo it while every text assertion here stays green.
    // Measured after the dock animation finishes, not on a timer: mid-flight the
    // card is still part-way through its travel and the join reads as the gap it
    // is in the middle of closing.
    await pin.evaluate(async (card) => {
      await Promise.all(card.parentElement!.getAnimations().map((a) => a.finished))
    })

    // Both edges read in one evaluate. Two `boundingBox()` calls can straddle a
    // layout change — a scrollbar appearing as the card arrives is enough — and
    // then the numbers are each correct and their difference is not.
    const join = await page.evaluate(() => {
      const panel = document.querySelector('[data-testid="bill-panel"]')!
      const card = document.querySelector('[data-testid="editing-order-pin"]')!
      return card.getBoundingClientRect().left - panel.getBoundingClientRect().right
    })
    expect(Math.round(join)).toBe(-1)

    const classicQuantity = page
      .getByRole('button', { name: 'One more Classic Chicken Shawarma' })
      .locator('xpath=preceding-sibling::span[1]')
    await expect(classicQuantity).toHaveText('2')
    await expect(page.getByPlaceholder('Customer name')).toHaveValue('Demo Customer')

    await page.getByRole('button', { name: 'Mayonnaise Chicken Shawarma', exact: true }).click()
    await page.getByPlaceholder('Customer name').fill('Updated customer')
    await page.getByPlaceholder('Phone number').fill('9000000222')
    await page.getByTestId('save-order').click()

    await expect(page.getByRole('heading', { name: 'Current bill' })).toBeVisible()
    await expect(pin).toHaveCount(0)
    await expect(page.getByPlaceholder('Customer name')).toHaveValue('Waiting customer')
    await expect(classicQuantity).toHaveText('1')
    await expect(order.getByText('Updated customer', { exact: true })).toBeVisible()
    await expect(order.getByText('Mayonnaise Chicken Shawarma', { exact: true })).toBeVisible()

    await order.getByRole('button', { name: /^More actions for Order .104$/ }).click()
    await order.getByRole('menuitem', { name: 'Edit' }).click()
    await page.getByRole('button', { name: 'One more Classic Chicken Shawarma' }).click()
    await page.getByTestId('cancel-edit').click()
    await expect(page.getByPlaceholder('Customer name')).toHaveValue('Waiting customer')
    await expect(classicQuantity).toHaveText('1')
  })

  test('offers exact-phone autofill only after the complete number and keeps conflicts local', async ({
    page,
  }) => {
    // The customer fields live in the composer, which opens on the first tap.
    await page.getByRole('button', { name: 'Classic Chicken Shawarma', exact: true }).click()
    await page.getByPlaceholder('Customer name').fill('Ria')
    await page.getByPlaceholder('Phone number').fill('900000010')
    await expect(page.getByTestId('customer-match')).toHaveCount(0)
    await page.getByPlaceholder('Phone number').fill('9000000101')
    await expect(page.getByTestId('customer-match')).toContainText(
      'replaces the name in this order only',
    )
    await page.getByRole('button', { name: 'Keep this order' }).click()
    await expect(page.getByPlaceholder('Customer name')).toHaveValue('Ria')
  })

  test('records a mixed cash and UPI payment in exact paise', async ({ page }) => {
    await page.getByRole('button', { name: 'Classic Chicken Shawarma', exact: true }).click()
    await page.getByPlaceholder('Customer name').fill('Demo Regular')
    await page.getByTestId('settle').click()
    const dialog = page.getByRole('dialog', { name: 'Record payment' })
    for (const digit of ['1', '0', '0']) {
      await dialog.getByRole('button', { name: digit, exact: true }).click()
    }
    await dialog.getByRole('button', { name: 'Cash', exact: true }).click()
    await expect(dialog.getByRole('list', { name: 'Payment split' })).toContainText('₹100')
    await dialog.getByRole('button', { name: 'UPI', exact: true }).click()
    await expect(dialog.getByRole('list', { name: 'Payment split' })).toContainText('₹39')
    await dialog.getByRole('button', { name: 'Paid', exact: true }).click()
    await expect(page.getByTestId('settled-confirmation')).toHaveCount(0)
    // The one split bill: both tenders readable once the composer gives the
    // money list back.
    const mixedBill = page
      .getByTestId('bill-column')
      .locator('details')
      .filter({ hasText: 'UPI' })
      .filter({ hasText: 'Cash' })
    await expect(mixedBill).toBeVisible()
  })

  test('cancels a compact open order with a one-tap reason and confirmation', async ({ page }) => {
    const rail = page.getByTestId('counter-activity-rail')
    const order = rail.getByTestId('open-order-104')
    await expect(order.getByRole('button', { name: /^More actions for Order .104$/ })).toBeVisible()
    await order.getByRole('button', { name: /^More actions for Order .104$/ }).click()
    await order.getByRole('menuitem', { name: 'Cancel order' }).click()

    const dialog = page.getByRole('dialog', { name: 'Cancel order 104' })
    const reason = dialog.getByRole('textbox', { name: 'Cancellation reason' })
    await expect(reason).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Other reason' })).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Duplicate order' }).click()
    await expect(reason).toHaveValue('Duplicate order')
    await reason.fill('Duplicate — customer confirmed')
    await dialog.getByRole('button', { name: 'Confirm cancel' }).click()
    // No confirmation bar: the card leaving the rail is the acknowledgement.
    await expect(rail.getByText('Order 104', { exact: true })).toHaveCount(0)
  })

  test('shows current-shift totals and exposes originating-tablet correction', async ({ page }) => {
    // Money history lives in the middle column now; the rail is the pipeline.
    const billsColumn = page.getByTestId('bill-column')
    await expect(billsColumn.getByRole('heading', { name: 'Bills this shift' })).toBeVisible()
    await expect(page.getByTestId('shift-total-cash')).toBeVisible()
    await expect(page.getByTestId('shift-total-upi')).toBeVisible()
    await expect(page.getByTestId('shift-total-swiggy')).toHaveCount(0)
    await expect(page.getByTestId('shift-total-zomato')).toHaveCount(0)
    await expect(billsColumn.getByText('Payment needs attention')).toBeVisible()
    await billsColumn.getByRole('button', { name: 'Correct with new copy' }).click()
    await expect(page.getByText(/linked correction was created/)).toBeVisible()
  })

  test('removes unsupported methods and keeps dedicated activity routes on narrower screens', async ({
    page,
  }) => {
    await page.getByRole('button', { name: 'Classic Chicken Shawarma', exact: true }).click()
    await page.getByPlaceholder('Customer name').fill('Demo Regular')
    await page.getByTestId('settle').click()
    const payment = page.getByRole('dialog', { name: 'Record payment' })
    for (const unsupported of ['Swiggy', 'Zomato', 'Card', 'Other']) {
      await expect(payment.getByRole('button', { name: unsupported })).toHaveCount(0)
    }
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('counter-activity-rail')).toBeVisible()
  })

  test('keeps all three columns while allowing the two right columns to resize', async ({
    page,
  }) => {
    const rail = page.getByTestId('counter-activity-rail')
    const grid = page.getByTestId('counter-workspace')

    // Open the composer so the middle column's own panel is measurable.
    await page.getByRole('button', { name: 'Classic Chicken Shawarma', exact: true }).click()
    const panel = page.getByTestId('bill-panel')
    await expect(panel).toBeVisible()

    // Default widths match; the menu takes the slack until a counter user changes either one.
    const wide = { panel: (await panel.boundingBox())!, rail: (await rail.boundingBox())! }
    expect(Math.round(wide.rail.width)).toBe(Math.round(wide.panel.width))
    await expect(grid).toHaveJSProperty('scrollWidth', await grid.evaluate((el) => el.clientWidth))

    // With slack in the menu column, each divider gives its own track more
    // width — and the menu's own minimum survives rather than hiding tiles.
    const menuColumn = grid.locator(':scope > div').first()
    const menuMinimum = await page.evaluate(
      () => Number.parseFloat(getComputedStyle(document.documentElement).fontSize) * 22,
    )
    const billResize = page.getByTestId('resize-current-bill-column')
    await billResize.press('ArrowLeft')
    const widenedBill = (await panel.boundingBox())!
    expect(Math.round(widenedBill.width)).toBeGreaterThan(Math.round(wide.panel.width))

    // The other divider is independently resizable, so the drag affordance
    // does not strand a keyboard user and it cannot change the bill width.
    const activityResize = page.getByTestId('resize-activity-column')
    await activityResize.press('ArrowLeft')
    const widenedRail = (await rail.boundingBox())!
    expect(Math.round(widenedRail.width)).toBeGreaterThan(Math.round(wide.rail.width))
    expect(Math.round((await menuColumn.boundingBox())!.width)).toBeGreaterThanOrEqual(menuMinimum)

    // Narrow enough that three of them cannot fit: still three, the grown
    // sizes persist on their own, and the workspace scrolls sideways rather
    // than folding a column into a tab.
    await page.setViewportSize({ width: 700, height: 900 })
    await expect(rail).toBeVisible()
    await expect(panel).toBeVisible()
    expect(Math.round((await panel.boundingBox())!.width)).toBe(Math.round(widenedBill.width))
    expect(await grid.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)

    // Sideways only. A counter whose page scrolls horizontally has lost its chrome.
    expect(
      await page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth),
    ).toBe(true)

    // And there is no second door to a column that never left.
    await expect(page.getByRole('link', { name: 'Open orders' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'My shift' })).toHaveCount(0)

    // With the menu pinned at its minimum there is no slack left, so any
    // further resize attempt — keyboard or pointer — is clamped back down to
    // the shared minimum track instead of creating gratuitous overflow.
    await billResize.press('ArrowLeft')
    expect(Math.round((await panel.boundingBox())!.width)).toBe(Math.round(wide.panel.width))
    const billResizeBox = (await billResize.boundingBox())!
    await page.mouse.move(billResizeBox.x + billResizeBox.width / 2, billResizeBox.y + 80)
    await page.mouse.down()
    await page.mouse.move(billResizeBox.x - 80, billResizeBox.y + 80)
    await page.mouse.up()
    expect(Math.round((await panel.boundingBox())!.width)).toBe(Math.round(wide.panel.width))
    await activityResize.press('ArrowLeft')
    expect(Math.round((await rail.boundingBox())!.width)).toBe(Math.round(wide.rail.width))

    const savedWidths = await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('shawarmania.counter-column-widths')!) as {
          bill: number
          activity: number
        },
    )

    // The counter is shared hardware, so its browser — rather than a person or
    // session — remembers the working layout after a reload.
    await page.reload()
    await expect(page.getByTestId('counter-workspace')).toHaveCSS(
      '--counter-bill-width',
      `${savedWidths.bill}px`,
    )
    await expect(page.getByTestId('counter-workspace')).toHaveCSS(
      '--counter-activity-width',
      `${savedWidths.activity}px`,
    )
  })

  test('requests the native numeric keypad for customer phone', async ({ page }) => {
    await page.getByRole('button', { name: 'Classic Chicken Shawarma', exact: true }).click()
    await expect(page.getByPlaceholder('Phone number')).toHaveAttribute('inputmode', 'numeric')
    await expect(page.getByPlaceholder('Phone number')).toHaveAttribute('pattern', '[0-9]*')
  })

  test('removes the legacy PIN shift surface now that the enrolled tablet owns handover', async ({
    page,
  }) => {
    await expect(page.getByRole('link', { name: 'Shift', exact: true })).toHaveCount(0)

    await page.goto('demo/biller/shift')
    await expect(page.getByRole('heading', { name: 'That page does not exist' })).toBeVisible()
    await expect(page.getByLabel(/PIN/i)).toHaveCount(0)
  })
})

test.describe('the counter offline', () => {
  test('accumulates, escalates, and drains when the connection returns', async ({
    page,
    context,
  }) => {
    await page.goto('demo/biller')
    await expect(page.getByTestId('sync-indicator')).toHaveAttribute('data-sync', 'pending')

    await context.setOffline(true)

    // Five bills is the escalation threshold from src/domain/billing.ts.
    for (let index = 0; index < 5; index += 1) {
      await page.getByRole('button', { name: 'Classic Chicken Shawarma', exact: true }).click()
      await recordPaid(page)
      // Cleared for the next customer even offline: durable locally, not sent.
      // No confirmation bar — the queued bill in the money list is the signal.
      await expect(page.getByRole('heading', { name: 'Bills this shift' })).toBeVisible()
      await expect(page.getByTestId('settled-confirmation')).toHaveCount(0)
    }

    await expect(page.getByTestId('sync-indicator')).toHaveAttribute('data-sync', 'stalled')
    await expect(page.getByTestId('sync-indicator')).toContainText('6 waiting')
    // Never a dialog, at any state.
    await expect(page.locator('dialog[open]')).toHaveCount(0)

    await context.setOffline(false)
    await expect(page.getByTestId('sync-indicator')).toHaveAttribute('data-sync', 'synced', {
      timeout: 15_000,
    })
    await expect(page.getByTestId('sync-indicator')).toContainText('synced')
  })
})

test.describe('the counter in both themes', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`renders in ${theme} with no console errors`, async ({ page }, testInfo) => {
      const errors: string[] = []
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text())
      })
      page.on('pageerror', (error) => errors.push(error.message))

      await page.goto('demo/biller')
      await setTheme(page, theme)
      await page.reload()

      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await expect(page.getByTestId('menu-grid')).toBeVisible()
      // The middle column's default is the money list; the composer is a mode.
      await expect(page.getByRole('heading', { name: 'Bills this shift' })).toBeVisible()

      await testInfo.attach(`counter-${theme}`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      })
      expect(errors).toEqual([])
    })
  }
})

test.describe('manager billing history', () => {
  test('opens structured bills in place, cancels progressively, clears an order and groups sync status', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('demo/admin/billing-history')
    await expect(page.getByRole('heading', { name: 'Billing history' })).toBeVisible()
    // Two questions and no more: the status and payment pickers are gone, and
    // the day is asked in the same bar the ledger uses.
    await expect(page.getByLabel('Bill status')).toHaveCount(0)
    await expect(page.getByLabel('Payment method')).toHaveCount(0)
    const period = page.getByTestId('billing-history-period')
    await expect(period).toHaveJSProperty(
      'scrollWidth',
      await period.evaluate((node) => node.clientWidth),
    )

    const businessDateButton = page.getByTestId('billing-history-day-open')
    const businessDatePicker = page.getByTestId('billing-history-day-picker')
    await expect(businessDateButton).toHaveText('Today')
    const todayBusinessDate = await businessDatePicker.inputValue()
    await businessDatePicker.fill('2026-08-01')
    await expect(businessDateButton).toHaveText('01 Aug 2026')
    // A step back reaches the day before without opening the calendar, and
    // there is no stepping past the outlet's own today.
    await page.getByTestId('billing-history-step-back').click()
    await expect(businessDateButton).toHaveText('31 Jul 2026')
    await businessDatePicker.fill(todayBusinessDate)
    await expect(businessDateButton).toHaveText('Today')
    await expect(page.getByTestId('billing-history-step-forward')).toBeDisabled()

    const bills = page.getByTestId('manager-bill-list').locator(':scope > li')
    const firstSummary = bills.nth(0).getByRole('button', { name: /Bill \d+ Paid/ })
    const secondSummary = bills.nth(1).getByRole('button', { name: /Bill \d+ Paid/ })
    await expect(firstSummary).toContainText(/(Today|Yesterday), \d{2}:\d{2} (am|pm)/)
    await expect(firstSummary).toContainText(/by Demo Biller/)
    await firstSummary.click()
    await expect(bills.nth(0)).toContainText('Order items')
    await expect(bills.nth(0)).toContainText('Paid by')
    await expect(firstSummary).not.toHaveClass(/border-primary/)
    await expect(
      bills.nth(0).getByTestId('manager-bill-detail-transition').locator('article'),
    ).not.toHaveClass(/border-primary/)
    const customerDetails = bills.nth(0).getByText('Customer details')
    const billTimeline = bills.nth(0).getByText('Bill timeline')
    const customerDisclosure = customerDetails.locator('xpath=ancestor::details')
    const timelineDisclosure = billTimeline.locator('xpath=ancestor::details')
    await expect(customerDisclosure).not.toHaveAttribute('open')
    await expect(timelineDisclosure).not.toHaveAttribute('open')
    await customerDetails.click()
    await expect(customerDisclosure).toHaveAttribute('open', '')
    await billTimeline.click()
    await expect(timelineDisclosure).toHaveAttribute('open', '')
    const detailBox = await bills.nth(0).getByTestId('manager-bill-detail-transition').boundingBox()
    expect(detailBox).not.toBeNull()
    // Even with both optional disclosures opened, the two-column facts stay bounded.
    expect(detailBox!.height).toBeLessThan(620)
    await expect(bills.nth(0).getByLabel(/Cancellation reason/)).toHaveCount(0)

    await secondSummary.evaluate((node) => node.scrollIntoView({ block: 'center' }))
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(200)
    const secondSummaryBeforeSwap = await secondSummary.boundingBox()
    expect(secondSummaryBeforeSwap).not.toBeNull()
    await secondSummary.click()
    await expect(firstSummary).toHaveAttribute('aria-expanded', 'false')
    await expect(secondSummary).toHaveAttribute('aria-expanded', 'true')
    await expect(bills.nth(0).getByTestId('manager-bill-detail-transition')).toHaveAttribute(
      'data-open',
      'false',
    )
    await page.waitForTimeout(280)
    await expect(bills.nth(0).getByTestId('manager-bill-detail-transition')).toHaveCount(0)
    const secondSummaryAfterSwap = await secondSummary.boundingBox()
    expect(secondSummaryAfterSwap).not.toBeNull()
    // The summary the manager pressed stays under the finger while the taller
    // detail above it closes. It holds by scrolling the page up as that detail
    // collapses, so the promise is bounded by the scroll the page actually has:
    // once the page is at its very top there is nothing left to give, and the
    // row rises by whatever was still owed. That case is allowed here, but only
    // there — a jump with room above it would be the regression this guards.
    const scrolledToTop = await page.evaluate(() => window.scrollY === 0)
    const shift = secondSummaryAfterSwap!.y - secondSummaryBeforeSwap!.y
    if (scrolledToTop) {
      expect(shift).toBeGreaterThan(-120)
      expect(shift).toBeLessThan(8)
    } else {
      expect(Math.abs(shift)).toBeLessThan(8)
    }
    await expect(secondSummary).toBeInViewport()
    await bills.nth(1).getByRole('button', { name: 'Cancel this bill' }).click()
    await bills
      .nth(1)
      .getByLabel(/Cancellation reason/)
      .fill('Wrong item rung')
    await bills.nth(1).getByRole('button', { name: 'Cancel bill' }).click()
    await expect(bills.nth(1)).toContainText('Cancelled')
    await expect(page.getByText(/Bill \d+ was cancelled/)).toHaveCount(0)

    await page.getByRole('tab', { name: /^Status/ }).click()
    await expect(page.getByRole('heading', { name: 'Payment totals' })).toBeVisible()
    await expect(page.getByTestId('billing-total-cash')).toBeVisible()
    await expect(page.getByTestId('billing-total-upi')).toBeVisible()
    await expect(page.getByTestId('billing-total-combined')).toBeVisible()
    await expect(page.getByTestId('billing-total-average')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Tablet sync status' })).toBeVisible()

    await page.getByRole('tab', { name: /Open orders/ }).click()
    const openOrder = page.getByTestId('manager-open-order-104')
    await expect(openOrder).toContainText('Order items')
    await expect(openOrder).toContainText('Customer details')
    await expect(openOrder).toContainText('created by')
    await expect(openOrder.getByLabel(/Cancellation reason for order/)).toHaveCount(0)
    await openOrder.getByRole('button', { name: 'Cancel this order' }).click()
    const orderCancellation = page.getByRole('dialog', { name: 'Cancel order 104' })
    await expect(orderCancellation).toBeVisible()
    await orderCancellation.getByLabel(/Cancellation reason for order/).fill('Tablet unavailable')
    await orderCancellation.getByRole('button', { name: 'Cancel order' }).click()
    await expect(openOrder).toHaveCount(0)
    await expect(page.getByText(/Nothing was transferred/)).toHaveCount(0)

    await page.getByRole('tab', { name: /^Status/ }).click()
    await expect(page.getByRole('heading', { name: 'Tablet sync status' })).toBeVisible()
    await expect(page.getByText(/recent sync problem/i)).toBeVisible()
    await expect(page.getByText(/Reference [0-9a-f]+/)).toBeHidden()
    await page.getByText(/Show technical details/).click()
    await expect(page.getByText(/Short references only/)).toBeVisible()
    await expect(page.getByText(/Reference [0-9a-f]+/)).toBeVisible()
    await expect(page.getByRole('button', { name: /Correct|Discard/ })).toHaveCount(0)
  })
})
