import { expect, test } from '@playwright/test'
import {
  OUTLET_KALYANI_ID as KAL,
  OUTLET_KANCHRAPARA_ID as KPA,
} from '../src/data-access/mock/fixtures/outlets'
import { overviewPeriod } from '../src/domain/overview'
import { resolveBusinessDate } from '../src/domain/datetime'

async function recordOutletShimmerCounts(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    const counts: number[] = []
    Object.defineProperty(window, '__overviewOutletShimmerCounts', { value: counts })
    const record = () => {
      const count = document.querySelectorAll('[data-testid="overview-outlet-shimmer"]').length
      if (count > 0) counts.push(count)
    }
    const observer = new MutationObserver(record)
    observer.observe(document, { childList: true, subtree: true })
  })
}

test('Overview remembers its last outlet-card loading shape across tabs', async ({
  page,
  baseURL,
}) => {
  await recordOutletShimmerCounts(page)
  await page.goto('demo/owner')
  await expect(page.locator('[data-testid^="outlet-card-"]')).toHaveCount(2)
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { __overviewOutletShimmerCounts: number[] })
          .__overviewOutletShimmerCounts,
    ),
  ).toContain(1)
  expect(await page.evaluate(() => localStorage.getItem('shawarmania.overview-outlet-count'))).toBe(
    '2',
  )

  const secondTab = await page.context().newPage()
  await recordOutletShimmerCounts(secondTab)
  await secondTab.goto(new URL('demo/owner', baseURL!).href)
  await expect(secondTab.locator('[data-testid^="outlet-card-"]')).toHaveCount(2)
  expect(
    await secondTab.evaluate(
      () =>
        (window as typeof window & { __overviewOutletShimmerCounts: number[] })
          .__overviewOutletShimmerCounts,
    ),
  ).toContain(2)
})

test('day one shows the completed previous month and links to it', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-01T12:00:00+05:30'))
  await page.goto('demo/owner')
  const card = page.getByTestId(`outlet-card-${KAL}`)
  await expect(card.getByRole('link', { name: /September revenue/ })).toBeVisible()
  await expect(card.getByRole('link', { name: /September revenue/ })).toHaveAttribute(
    'title',
    'September revenue · Full month',
  )
  await card.getByRole('link', { name: /September revenue/ }).click()
  await expect(page.getByTestId('statement-month-picker')).toHaveAttribute('data-month', '2026-09')
})

test('Overview links preserve outlet and the displayed month on reload', async ({ page }) => {
  await page.goto('demo/owner')
  const card = page.getByTestId(`outlet-card-${KPA}`)
  await expect(page.getByTestId(`sales-${KPA}`)).toBeVisible()
  await card.getByRole('link', { name: /Today's counter sales/ }).click()
  await expect(page).toHaveURL(new RegExp(`billing-history\\?outlet=${KPA}`))
  await expect(page.getByTestId('manager-bill-list')).toBeVisible()
  await page.goto('demo/owner')
  await page.getByTestId(`open-outlet-${KPA}`).click()
  await expect(page).toHaveURL(new RegExp(`devices/${KPA}`))
  await expect(page.getByRole('heading', { name: 'Tablets' })).toBeVisible()
  await page.goto('demo/owner')
  await page
    .getByTestId(`outlet-card-${KAL}`)
    .getByRole('link', { name: /revenue/ })
    .click()
  const month = overviewPeriod(resolveBusinessDate(new Date(), '04:00')).month
  await expect(page).toHaveURL(new RegExp(`ledger\\?outlet=${KAL}&view=month&month=${month}`))
  await page.reload()
  await expect(page.getByTestId('statement-month-picker')).toHaveAttribute('data-month', month)
  await expect(page.getByRole('button', { name: 'The month', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})

test('Overview expected cash agrees with its linked Drawer', async ({ page }) => {
  await page.goto('demo/owner')
  const amount = page.getByTestId(`cash-${KAL}`)
  await expect(amount).toBeVisible()
  const expected = await amount.innerText()
  await page
    .getByTestId(`outlet-card-${KAL}`)
    .getByRole('link', { name: /Drawer cash/ })
    .click()
  await expect(page.getByTestId('expected-now')).toHaveText(expected)
})

test('Overview and source pages stay inside demo with no external requests', async ({
  page,
  baseURL,
}) => {
  const violations: string[] = []
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== new URL(baseURL!).origin) violations.push(request.url())
  })
  for (const path of [
    'demo/owner',
    `demo/owner/drawer?outlet=${KAL}`,
    `demo/owner/ledger?outlet=${KPA}&view=month&month=2026-08`,
    `demo/owner/devices/${KPA}`,
    'demo/admin',
  ]) {
    await page.goto(path)
    await expect(page.getByTestId('demo-banner')).toBeVisible()
  }
  expect(violations).toEqual([])
  expect(errors).toEqual([])
})

for (const viewport of [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 1080, height: 810 },
]) {
  for (const theme of ['light', 'dark']) {
    test(`Overview ${theme} on ${viewport.name}`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport)
      await page.goto('.')
      await page.evaluate((value) => localStorage.setItem('shawarmania.theme', value), theme)
      await page.goto('demo/owner')
      await expect(page.getByTestId(`sales-${KAL}`)).toBeVisible()
      await expect(page.getByTestId(`revenue-${KAL}`)).toBeVisible()
      await expect(page.getByTestId('overview-attention-attendance-waiting')).toBeVisible()
      await expect(page.locator('[data-testid^="outlet-card-"]')).toHaveCount(2)
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(1)
      const captions = page.getByTestId('metric-subtext')
      await expect(captions).toHaveCount(8)
      expect(
        await captions.evaluateAll((nodes) =>
          nodes.every(
            (node) =>
              node.scrollWidth <= node.clientWidth + 1 &&
              node.getBoundingClientRect().height <=
                parseFloat(getComputedStyle(node).lineHeight) + 1,
          ),
        ),
      ).toBe(true)
      if (viewport.name === 'phone') {
        const bottom = await page
          .getByTestId('overview-attention-attendance-waiting')
          .evaluate((node) => node.getBoundingClientRect().bottom)
        const navTop = await page
          .locator('nav')
          .evaluateAll(
            (nodes) =>
              nodes
                .find((node) => getComputedStyle(node).position === 'fixed')!
                .getBoundingClientRect().top,
          )
        expect(bottom).toBeLessThanOrEqual(navTop)
      }
      await page.screenshot({
        path: testInfo.outputPath(`overview-${theme}-${viewport.name}.png`),
        fullPage: true,
      })
    })
  }
}

for (const viewport of [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 1080, height: 810 },
]) {
  for (const theme of ['light', 'dark']) {
    test(`Tablet edit sheet is usable in ${theme} on ${viewport.name}`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize(viewport)
      await page.goto('.')
      await page.evaluate((value) => localStorage.setItem('shawarmania.theme', value), theme)
      await page.goto(`demo/owner/devices/${KAL}`)

      await page.getByRole('button', { name: 'Edit Counter tablet' }).click()
      const sheet = page.getByRole('dialog', { name: 'Edit Counter tablet' })
      const name = sheet.getByLabel('Name')
      await expect(sheet).toBeVisible()
      await expect(name).toHaveValue('Counter tablet')
      await expect(name).toBeFocused()
      await expect(sheet.getByRole('combobox', { name: 'Outlet' })).toHaveValue(KAL)
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)

      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(1)
      expect(
        await sheet.evaluate((node) => {
          const bounds = node.getBoundingClientRect()
          return (
            bounds.left >= 0 &&
            bounds.top >= 0 &&
            bounds.right <= window.innerWidth &&
            bounds.bottom <= window.innerHeight
          )
        }),
      ).toBe(true)

      await page.screenshot({
        path: testInfo.outputPath(`tablet-edit-${theme}-${viewport.name}.png`),
        fullPage: true,
      })
    })
  }
}
