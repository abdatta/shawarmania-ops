import type { Locator, Page } from '@playwright/test'

import { expect, test } from './test'

/**
 * Dish photos in the demo (a-dish-can-show-its-photo, task 2.5): a manager
 * frames, re-frames, changes and removes a dish's photo in the Menu editor.
 * Every assertion holds only with `dish-photos` on.
 *
 * The photos are drawn by the page's own canvas and picked as JPEG files, so
 * the real decoder, cropper and encoder run end to end.
 */

const ON = { tag: '@cg-on:dish-photos' }

/** A camera-like JPEG of a given size, drawn in the page. */
async function photo(page: Page, width: number, height: number, hue = 24) {
  const base64 = await page.evaluate(
    ({ width, height, hue }) => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')!
      const ground = ctx.createLinearGradient(0, 0, width, height)
      ground.addColorStop(0, `hsl(${hue} 70% 30%)`)
      ground.addColorStop(1, `hsl(${hue + 30} 80% 60%)`)
      ctx.fillStyle = ground
      ctx.fillRect(0, 0, width, height)
      for (let i = 0; i < 12; i++) {
        ctx.fillStyle = `hsl(${hue + i * 20} 70% ${40 + (i % 3) * 10}%)`
        ctx.beginPath()
        ctx.arc(
          ((i * 37) % 100) * (width / 100),
          ((i * 53) % 100) * (height / 100),
          width / 12,
          0,
          7,
        )
        ctx.fill()
      }
      return canvas.toDataURL('image/jpeg', 0.9).split(',')[1]!
    },
    { width, height, hue },
  )
  return { name: 'dish.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(base64, 'base64') }
}

async function openEditor(page: Page, dish: string): Promise<Locator> {
  await page.getByRole('button', { name: `Actions for ${dish}` }).click()
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  const sheet = page.getByRole('dialog', { name: `Edit ${dish}` })
  await expect(sheet).toBeVisible()
  return sheet
}

async function pick(page: Page, file: Awaited<ReturnType<typeof photo>>) {
  await page.getByTestId('menu-photo-input').setInputFiles(file)
  await expect(page.getByTestId('photo-cropper')).toBeVisible()
}

async function frame(page: Page, shape?: string) {
  if (shape) await page.getByRole('button', { name: shape }).click()
  await expect(page.getByTestId('cropper-title')).toHaveText('Frame the photo')
  await expect(page.getByTestId('crop-thumbnail')).toBeVisible()
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByTestId('photo-cropper')).toBeHidden()
}

const rowPhoto = (page: Page, dish: string) =>
  page.locator('li', { hasText: dish }).locator('[data-testid^="menu-photo-row-"]')

async function save(sheet: Locator) {
  await sheet.getByRole('button', { name: 'Save changes' }).click()
  await expect(sheet).toBeHidden()
}

test.beforeEach(async ({ page }) => {
  await page.goto('demo/admin/menu')
  await expect(page.getByTestId('menu-list')).toBeVisible()
})

test('adds a photo in each shape, adjusts, changes and removes it', ON, async ({ page }) => {
  const shapes = [
    ['Classic Chicken Shawarma', 'Wide, 4:3', 4 / 3, [2400, 1800]],
    ['Paneer Shawarma', 'Square, 1:1', 1, [2000, 1500]],
    ['Smashed Veg Burger', 'Tall, 4:5', 4 / 5, [1500, 2000]],
  ] as const
  for (const [dish, shape, ratio, [width, height]] of shapes) {
    const sheet = await openEditor(page, dish)
    await expect(sheet.getByTestId('menu-photo-empty')).toBeVisible()
    await pick(page, await photo(page, width, height))
    await frame(page, shape)
    const large = await sheet.getByTestId('menu-photo-large').boundingBox()
    expect(large!.width / large!.height).toBeCloseTo(ratio, 1)
    await expect(sheet.getByTestId('menu-photo-thumb')).toBeVisible()
    await save(sheet)
    await expect(rowPhoto(page, dish)).toBeVisible()
  }

  // Adjust: the saved shape comes back, and a new framing is a new photo.
  const before = await rowPhoto(page, 'Classic Chicken Shawarma').getAttribute('src')
  let sheet = await openEditor(page, 'Classic Chicken Shawarma')
  await sheet.getByRole('button', { name: 'Adjust' }).click()
  await expect(page.getByRole('button', { name: 'Wide, 4:3' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.getByTestId('crop-stage').focus()
  await page.keyboard.press('+')
  await page.keyboard.press('ArrowLeft')
  await frame(page)
  await save(sheet)
  await expect(rowPhoto(page, 'Classic Chicken Shawarma')).not.toHaveAttribute('src', before!)

  // Change: a new photo replaces the old one.
  const paneer = await rowPhoto(page, 'Paneer Shawarma').getAttribute('src')
  sheet = await openEditor(page, 'Paneer Shawarma')
  const file = await photo(page, 1800, 1800, 200)
  const chooser = page.waitForEvent('filechooser')
  await sheet.getByRole('button', { name: 'Change', exact: true }).click()
  await (await chooser).setFiles(file)
  await expect(page.getByTestId('photo-cropper')).toBeVisible()
  await frame(page)
  await save(sheet)
  await expect(rowPhoto(page, 'Paneer Shawarma')).not.toHaveAttribute('src', paneer!)

  // Remove: the row goes back to how it read before.
  sheet = await openEditor(page, 'Smashed Veg Burger')
  await sheet.getByRole('button', { name: 'Remove' }).click()
  await expect(sheet.getByTestId('menu-photo-empty')).toBeVisible()
  await save(sheet)
  await expect(rowPhoto(page, 'Smashed Veg Burger')).toHaveCount(0)
  await expect(page.locator('[data-testid^="menu-photo-row-"]')).toHaveCount(2)
})

test('Cancel discards a picked photo', ON, async ({ page }) => {
  const sheet = await openEditor(page, 'Classic Chicken Shawarma')
  await pick(page, await photo(page, 1600, 1200))
  await frame(page)
  await sheet.getByRole('button', { name: 'Close' }).click()
  await expect(sheet).toBeHidden()
  await expect(rowPhoto(page, 'Classic Chicken Shawarma')).toHaveCount(0)
  const again = await openEditor(page, 'Classic Chicken Shawarma')
  await expect(again.getByTestId('menu-photo-empty')).toBeVisible()
})

test(
  'frames the thumbnail separately and keeps it through a later Adjust',
  ON,
  async ({ page }) => {
    let sheet = await openEditor(page, 'Classic Chicken Shawarma')
    await pick(page, await photo(page, 2400, 1800))
    await page.getByRole('button', { name: 'Frame the thumbnail separately ›' }).click()
    await expect(page.getByTestId('cropper-title')).toHaveText('Thumbnail')
    await page.getByTestId('crop-stage').focus()
    for (const key of ['+', '+', '+', 'ArrowRight']) await page.keyboard.press(key)
    await page.getByRole('button', { name: 'Done' }).click()
    await expect(page.getByTestId('photo-cropper')).toBeHidden()
    await save(sheet)

    // Moving the large frame on Adjust leaves the thumbnail as the manager framed it.
    sheet = await openEditor(page, 'Classic Chicken Shawarma')
    await sheet.getByRole('button', { name: 'Adjust' }).click()
    await expect(page.getByTestId('crop-thumbnail')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Change the thumbnail ›' })).toBeVisible()
    await page.getByTestId('crop-stage').focus()
    await page.keyboard.press('+')
    await page.getByRole('button', { name: 'Done' }).click()
    await save(sheet)

    // Saved and reopened, it is still the manager's; Match the photo puts the
    // dashed square back.
    sheet = await openEditor(page, 'Classic Chicken Shawarma')
    await sheet.getByRole('button', { name: 'Adjust' }).click()
    await page.getByRole('button', { name: 'Change the thumbnail ›' }).click()
    await page.getByRole('button', { name: 'Match the photo' }).click()
    await expect(page.getByTestId('crop-thumbnail')).toBeVisible()
  },
)

test('a failed upload keeps the dish’s other edits and retries', ON, async ({ page, context }) => {
  const sheet = await openEditor(page, 'Classic Chicken Shawarma')
  await pick(page, await photo(page, 1600, 1200))
  await frame(page)
  await sheet.getByLabel('Price (₹)').fill('199')

  await context.setOffline(true)
  await sheet.getByRole('button', { name: 'Save changes' }).click()
  const failed = sheet.getByTestId('menu-photo-failed')
  await expect(failed).toContainText('Photo not saved')
  await expect(page.locator('li', { hasText: 'Classic Chicken Shawarma' })).toContainText('₹199')

  await context.setOffline(false)
  await failed.getByRole('button', { name: 'Retry' }).click()
  await expect(sheet).toBeHidden()
  await expect(rowPhoto(page, 'Classic Chicken Shawarma')).toBeVisible()
  await expect(page.locator('li', { hasText: 'Classic Chicken Shawarma' })).toContainText('₹199')
})

test('frames by touch: one finger moves, two fingers zoom', ON, async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'tablet', 'touch is the tablet project’s')
  await openEditor(page, 'Classic Chicken Shawarma')
  await pick(page, await photo(page, 2400, 1800))
  const stage = page.getByTestId('crop-stage')
  const box = (await stage.boundingBox())!
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  const image = page.getByTestId('crop-image')
  const widthOf = async () => (await image.boundingBox())!.width
  const leftOf = async () => (await image.boundingBox())!.x

  const cdp = await page.context().newCDPSession(page)
  const touch = (
    type: 'touchStart' | 'touchMove' | 'touchEnd',
    points: { x: number; y: number; id: number }[],
  ) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: points.map(({ x, y, id }) => ({ x, y, id })),
    })

  // Two fingers apart: the photo grows under the frame.
  const startWidth = await widthOf()
  await touch('touchStart', [
    { x: cx - 30, y: cy, id: 1 },
    { x: cx + 30, y: cy, id: 2 },
  ])
  for (let step = 1; step <= 5; step++) {
    await touch('touchMove', [
      { x: cx - 30 - step * 12, y: cy, id: 1 },
      { x: cx + 30 + step * 12, y: cy, id: 2 },
    ])
  }
  await touch('touchEnd', [])
  expect(await widthOf()).toBeGreaterThan(startWidth * 1.5)

  // One finger: the photo follows it.
  const startLeft = await leftOf()
  await touch('touchStart', [{ x: cx, y: cy, id: 1 }])
  for (let step = 1; step <= 5; step++)
    await touch('touchMove', [{ x: cx + step * 10, y: cy, id: 1 }])
  await touch('touchEnd', [])
  expect(await leftOf()).toBeGreaterThan(startLeft + 20)

  // However far it is pushed, the photo still covers the frame.
  await touch('touchStart', [{ x: cx, y: cy, id: 1 }])
  for (let step = 1; step <= 5; step++)
    await touch('touchMove', [{ x: cx + step * 400, y: cy, id: 1 }])
  await touch('touchEnd', [])
  const frameBox = (await page.getByTestId('crop-frame').boundingBox())!
  const imageBox = (await image.boundingBox())!
  expect(imageBox.x).toBeLessThanOrEqual(frameBox.x + 1)
  expect(imageBox.y).toBeLessThanOrEqual(frameBox.y + 1)
  expect(imageBox.x + imageBox.width).toBeGreaterThanOrEqual(frameBox.x + frameBox.width - 1)
})

for (const viewport of [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 1080, height: 810 },
]) {
  for (const theme of ['light', 'dark']) {
    test(
      `the editor and cropper on ${viewport.name} in ${theme}`,
      ON,
      async ({ page }, testInfo) => {
        await page.setViewportSize(viewport)
        await page.evaluate((value) => localStorage.setItem('shawarmania.theme', value), theme)
        await page.reload()
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
        const sheet = await openEditor(page, 'Classic Chicken Shawarma')
        await pick(page, await photo(page, 2400, 1800))
        // Nothing spills past the screen's edges in the cropper.
        for (const id of ['crop-stage', 'cropper-title']) {
          const box = (await page.getByTestId(id).boundingBox())!
          expect(box.x).toBeGreaterThanOrEqual(0)
          expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1)
        }
        await expect(page.getByRole('button', { name: 'Done' })).toBeInViewport()
        await expect(page.getByRole('group', { name: 'Shape' })).toBeInViewport()
        await testInfo.attach(`cropper-${viewport.name}-${theme}`, {
          body: await page.screenshot(),
          contentType: 'image/png',
        })
        await frame(page)
        await expect(sheet.getByTestId('menu-photo-preview')).toBeInViewport()
        await testInfo.attach(`editor-${viewport.name}-${theme}`, {
          body: await page.screenshot(),
          contentType: 'image/png',
        })
      },
    )
  }
}
