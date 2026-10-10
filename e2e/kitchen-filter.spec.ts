import { expect, test, type Page } from '@playwright/test'

async function only(page: Page, category: 'Shawarmas' | 'Burgers') {
  await page.getByRole('button', { name: /^Filter: / }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('radio', { name: 'Only these' }).click()
  for (const choice of ['Shawarmas', 'Burgers']) {
    await dialog
      .getByRole('checkbox', { name: new RegExp(choice, 'i') })
      .setChecked(choice === category)
  }
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByTestId('kitchen-filter-summary')).toHaveText(`Only ${category}`)
}

for (const theme of ['light', 'dark'] as const) {
  test(`an acknowledged order leaves and returns quietly through filter changes (${theme})`, async ({
    page,
    context,
  }, testInfo) => {
    await page.addInitScript((value) => localStorage.setItem('shawarmania.theme', value), theme)
    await page.goto('demo/biller')
    const counterCard = page.getByTestId('open-order-105')
    await expect(counterCard.getByTestId('kitchen-bell')).toHaveAttribute('data-ringing', 'true')
    const kitchen = await context.newPage()
    await kitchen.goto('demo/kitchen')
    await only(kitchen, 'Shawarmas')
    const card = kitchen.getByTestId('kitchen-card-105')
    await expect(card).toHaveAttribute('data-state', 'new')
    await expect(card.locator('..')).not.toHaveClass(/kitchen-shake/)
    await expect(card.getByRole('button', { name: 'ACK order 105' })).not.toHaveAttribute(
      'data-ringing',
    )
    await card.getByRole('button', { name: 'ACK order 105' }).click()
    await expect(card).toHaveAttribute('data-state', 'quiet')
    await expect(counterCard.getByTestId('kitchen-bell')).not.toHaveAttribute('data-ringing')

    // Observe the whole sequence: a transient waiting answer must also fail.
    await page.evaluate(() => {
      const card = document.querySelector('[data-testid="open-order-105"]')!
      const violations: string[] = []
      const observer = new MutationObserver(() => {
        if (card.querySelector('[data-ringing="true"]')) violations.push('counter bell rang')
      })
      observer.observe(card, { subtree: true, childList: true, attributes: true })
      Object.assign(window, { kitchenFilterViolations: violations })
    })
    await only(kitchen, 'Burgers')
    await expect(card).toHaveCount(0)
    await expect(counterCard.getByTestId('kitchen-bell')).toHaveCount(0)
    await only(kitchen, 'Shawarmas')
    await expect(card).toHaveAttribute('data-state', 'quiet')
    await expect(card.locator('..')).not.toHaveClass(/kitchen-shake/)
    await expect(card.getByRole('button')).toHaveCount(0)
    await expect(counterCard.getByTestId('kitchen-bell')).toHaveAccessibleName(
      'Kitchen 1 has pressed ACK',
    )
    expect(
      await page.evaluate(
        () => (window as unknown as { kitchenFilterViolations: string[] }).kitchenFilterViolations,
      ),
    ).toEqual([])
    await testInfo.attach(`kitchen-filter-${theme}`, {
      body: await kitchen.screenshot(),
      contentType: 'image/png',
    })
  })
}
