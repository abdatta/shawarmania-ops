import { expect, test } from '@playwright/test'

for (const viewport of [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 1080, height: 810 },
]) {
  for (const theme of ['light', 'dark']) {
    test(`menu presentation on ${viewport.name} in ${theme}`, async ({
      page,
      baseURL,
    }, testInfo) => {
      const origin = new URL(baseURL!).origin
      const external: string[] = []
      const errors: string[] = []
      page.on('request', (request) => {
        if (new URL(request.url()).origin !== origin) external.push(request.url())
      })
      page.on('pageerror', (error) => errors.push(error.message))
      await page.setViewportSize(viewport)
      await page.addInitScript((value) => localStorage.setItem('shawarmania.theme', value), theme)
      await page.goto('demo/admin/menu')
      await expect(page.getByTestId('menu-highlights')).toBeVisible()
      await expect(page.getByTestId('discount-presets')).toHaveCount(0)
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)

      const discounts = page.getByTestId('menu-discounts')
      const highlightsCard = page.getByTestId('menu-highlights')
      const discountsBox = await discounts.boundingBox()
      const highlightsBox = await highlightsCard.boundingBox()
      expect(discountsBox!.y + discountsBox!.height).toBeLessThan(highlightsBox!.y)
      expect(highlightsBox!.height).toBeLessThanOrEqual(72)
      const discountHeading = await discounts.getByRole('heading').boundingBox()
      const discountSubtitle = await discounts
        .getByText('Category or whole-menu discounts.')
        .boundingBox()
      const addDiscount = await discounts
        .getByRole('button', { name: 'Add Discount' })
        .boundingBox()
      expect(discountSubtitle!.y).toBeGreaterThan(discountHeading!.y)
      expect(addDiscount!.x).toBeGreaterThan(discountSubtitle!.x + discountSubtitle!.width)
      expect(addDiscount!.y).toBeLessThan(discountSubtitle!.y)
      // Reproduce the owner's empty setup: no running discount, no promoted dishes.
      for (const stop of await discounts.getByRole('button', { name: /^Stop the/ }).all()) {
        await stop.click()
      }
      await expect(discounts.getByRole('button', { name: /^Stop the/ })).toHaveCount(0)
      const menuBox = await page.getByTestId('menu-list').boundingBox()
      if (viewport.name === 'phone') expect(menuBox!.y).toBeLessThan(viewport.height / 2)
      await testInfo.attach(`empty-menu-${viewport.name}-${theme}`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      })

      await page.getByRole('button', { name: 'Actions for Peri Peri Chicken Shawarma' }).click()
      await expect(page.getByRole('button', { name: 'Move up', exact: true })).toBeDisabled()
      await page.getByRole('button', { name: 'Move down', exact: true }).click()
      const category = page.getByTestId('menu-list').locator('[data-testid^="category-"]').first()
      await expect(category.locator('li').first()).toContainText('Mayonnaise Chicken Shawarma')

      await page.getByRole('button', { name: 'Edit highlights' }).click()
      await page.getByLabel('Section name').fill('Newly Launched')
      await page.getByLabel('Choose dishes', { exact: true }).fill('classic')
      await page.getByRole('checkbox', { name: 'Highlight Classic Chicken Shawarma' }).check()
      await page.getByLabel('Choose dishes', { exact: true }).fill('lebanese')
      await page.getByRole('checkbox', { name: 'Highlight Lebanese Chicken Shawarma' }).check()
      await page
        .getByRole('button', { name: 'Move Lebanese Chicken Shawarma up in highlights' })
        .click()
      await page.getByLabel('Choose dishes', { exact: true }).fill('')
      const editorBox = await page.getByRole('dialog').boundingBox()
      const searchBox = await page.getByLabel('Choose dishes', { exact: true }).boundingBox()
      expect(searchBox!.y - editorBox!.y).toBeLessThanOrEqual(300)
      await testInfo.attach(`editor-${viewport.name}-${theme}`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      })
      await page.getByRole('button', { name: 'Save highlights' }).click()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      const highlights = page.getByTestId('menu-highlights')
      await expect(highlights.getByRole('heading')).toHaveText('Newly Launched')
      await expect(highlights.locator('li').first()).toContainText('Lebanese Chicken Shawarma')
      await expect(highlights.locator('li').first()).toContainText('Unavailable')
      await expect(highlights.getByRole('img', { name: 'Highlighted' })).toHaveCount(0)
      const unavailableRow = category.locator('li').filter({ hasText: 'Lebanese Chicken Shawarma' })
      await expect(unavailableRow.getByRole('img', { name: 'Highlighted' })).toHaveCount(1)
      const unavailableIcon = unavailableRow.getByRole('img', { name: 'Unavailable' })
      await expect(unavailableIcon).toHaveCount(1)
      expect((await unavailableIcon.boundingBox())!.width).toBeLessThanOrEqual(20)
      await unavailableRow
        .getByRole('button', { name: 'Actions for Lebanese Chicken Shawarma' })
        .click()
      const availableAction = page.getByRole('button', { name: 'Mark available', exact: true })
      await expect(availableAction).toBeVisible()
      // Opacity on an ancestor composites the entire fixed dropdown, even if
      // the panel's own opacity is 1. The row must only mute its item details.
      expect(
        await availableAction.evaluate((element) => {
          let opacity = 1
          for (let node: Element | null = element; node; node = node.parentElement) {
            opacity *= Number(getComputedStyle(node).opacity)
          }
          return opacity
        }),
      ).toBe(1)
      await testInfo.attach(`unavailable-actions-${viewport.name}-${theme}`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      })
      await page.keyboard.press('Escape')
      await page.evaluate(() => window.scrollTo(0, 0))
      await testInfo.attach(`menu-${viewport.name}-${theme}`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      })
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true)

      await expect(highlights.getByText('Classic Chicken Shawarma', { exact: true })).toHaveCount(1)
      await expect(category.getByText('Classic Chicken Shawarma', { exact: true })).toHaveCount(1)
      await expect(page.getByRole('button', { name: 'Preview customer menu' })).toHaveCount(0)

      await page.getByRole('button', { name: 'Edit highlights' }).click()
      await page.getByLabel('Section name').fill('Discarded')
      await page.getByRole('button', { name: 'Close', exact: true }).click()
      await expect(highlights.getByRole('heading')).toHaveText('Newly Launched')
      await page.getByRole('button', { name: 'Edit highlights' }).click()
      await page
        .getByRole('button', { name: 'Remove Lebanese Chicken Shawarma from highlights' })
        .click()
      await page
        .getByRole('button', { name: 'Remove Classic Chicken Shawarma from highlights' })
        .click()
      await page.getByRole('button', { name: 'Save highlights' }).click()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(highlights).toContainText('Highlight dishes at the top of your menu.')
      await expect(highlights.locator('li')).toHaveCount(0)
      await expect(category.getByRole('img', { name: 'Highlighted' })).toHaveCount(0)

      await page.getByRole('link', { name: 'Outlets', exact: true }).click()
      await page.getByTestId('open-kalyani').click()
      const ordersSettings = page.getByTestId('service-orders')
      const counterSettings = ordersSettings.getByTestId('outlet-discount-presets')
      await expect(counterSettings).toContainText('Bill discount shortcuts')
      await expect(page.getByRole('heading', { name: 'Counter presets', exact: true })).toHaveCount(
        0,
      )
      await expect(counterSettings.getByTestId('preset-percent-1000')).toBeVisible()
      const shortcutBox = await counterSettings.boundingBox()
      expect(shortcutBox!.height).toBeLessThanOrEqual(180)
      const firstShortcut = await counterSettings.getByTestId('preset-percent-1000').boundingBox()
      const lastShortcut = await counterSettings.getByTestId('preset-percent-2000').boundingBox()
      expect(lastShortcut!.y).toBe(firstShortcut!.y)
      // Every nonempty configuration fills one row, from one through four.
      async function expectShortcutRow(count: number) {
        const buttons = counterSettings.locator('button[data-testid^="preset-percent-"]')
        await expect(buttons).toHaveCount(count)
        const boxes = await Promise.all((await buttons.all()).map((button) => button.boundingBox()))
        const row = await buttons.first().locator('..').boundingBox()
        for (const box of boxes) {
          expect(Math.abs(box!.y - boxes[0]!.y)).toBeLessThan(1)
          expect(Math.abs(box!.width - boxes[0]!.width)).toBeLessThan(1)
          expect(box!.height).toBeGreaterThanOrEqual(44)
        }
        expect(Math.abs(boxes[0]!.x - row!.x)).toBeLessThan(1)
        const last = boxes.at(-1)!
        expect(Math.abs(last!.x + last!.width - row!.x - row!.width)).toBeLessThan(1)
      }
      await expectShortcutRow(3)
      const valueBox = await counterSettings.getByLabel('New preset value').boundingBox()
      const addBox = await counterSettings.getByTestId('add-preset').boundingBox()
      expect(Math.abs(valueBox!.y - addBox!.y)).toBeLessThanOrEqual(8)
      expect(
        await counterSettings.evaluate((element) => element.scrollWidth <= element.clientWidth),
      ).toBe(true)
      await counterSettings.scrollIntoViewIfNeeded()
      await testInfo.attach(`outlet-presets-${viewport.name}-${theme}`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      })
      await page.getByLabel('New preset value').fill('25')
      await page.getByTestId('add-preset').click()
      await expect(page.getByTestId('add-preset')).toHaveCount(0)
      await expectShortcutRow(4)
      await testInfo.attach(`preset-editor-${viewport.name}-${theme}`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      })
      await ordersSettings.getByRole('switch', { name: 'Collect customer details' }).click()
      const orderSave = ordersSettings.getByTestId('service-save')
      await expect(orderSave).toHaveText('Save')
      // Capture the unfolded save bar, including the button's bottom edge.
      await expect
        .poll(async () => {
          const bar = await ordersSettings.getByTestId('service-save-bar').boundingBox()
          const button = await orderSave.boundingBox()
          return bar!.height - button!.height
        })
        .toBeGreaterThanOrEqual(2)
      const orderSaveBox = await ordersSettings.getByTestId('service-save-bar').boundingBox()
      const separateShortcutsBox = await counterSettings.boundingBox()
      expect(orderSaveBox!.y + orderSaveBox!.height).toBeLessThan(separateShortcutsBox!.y)
      await orderSave.scrollIntoViewIfNeeded()
      await testInfo.attach(`independent-saves-${viewport.name}-${theme}`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      })
      await orderSave.click()
      await expect(ordersSettings.getByTestId('service-saved')).toBeVisible()
      await expect(counterSettings.getByRole('button', { name: 'Save', exact: true })).toBeVisible()
      await counterSettings.getByRole('button', { name: 'Save', exact: true }).click()
      await expect(counterSettings.getByTestId('presets-saved')).toBeVisible()
      const savedShortcutsCard = ordersSettings.getByTestId('presets-card')
      await expect(savedShortcutsCard).toHaveAttribute('data-saved', 'true')
      expect(
        await savedShortcutsCard.evaluate((element) => getComputedStyle(element).animationName),
      ).toBe('saved-glow')
      await testInfo.attach(`preset-saved-${viewport.name}-${theme}`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      })
      await page.emulateMedia({ reducedMotion: 'reduce' })
      expect(
        await savedShortcutsCard.evaluate((element) => getComputedStyle(element).animationName),
      ).toBe('none')
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      await expect(counterSettings).toContainText('25%')
      await page.getByRole('button', { name: 'Remove the 10% preset' }).click()
      await expectShortcutRow(3)
      await page.getByRole('button', { name: 'Remove the 15% preset' }).click()
      await expectShortcutRow(2)
      await page.getByRole('button', { name: 'Remove the 20% preset' }).click()
      await expectShortcutRow(1)
      await counterSettings.getByTestId('presets-cancel').click()
      await expect(counterSettings.getByTestId('preset-percent-1000')).toBeVisible()
      await expect(counterSettings.getByTestId('preset-percent-2500')).toBeVisible()
      await page.getByRole('link', { name: 'Menu', exact: true }).click()
      await expect(page.getByTestId('discount-presets')).toHaveCount(0)
      expect(external).toEqual([])
      expect(errors).toEqual([])
    })
  }
}
