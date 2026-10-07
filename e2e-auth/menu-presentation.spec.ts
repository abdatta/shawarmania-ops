import { createClient } from '@supabase/supabase-js'
import { expect, test } from '@playwright/test'
import type { Database } from '../src/data-access/database.types'
import { createSupabaseMenuAdapter } from '../src/data-access/supabase-adapters/menu'

const outlet = '00000000-0000-4000-a000-000000000001'
const classic = '31000000-0000-4000-a000-000000000001'
const url = process.env['VITE_SUPABASE_URL'] ?? 'http://127.0.0.1:54321'
const anonKey =
  process.env['VITE_SUPABASE_ANON_KEY'] ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

test('approved menu controls persist and reload through the live adapter in both themes and viewports', async ({
  page,
}, testInfo) => {
  if (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname))
    throw new Error('This probe needs the local stack')
  const client = createClient<Database>(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  expect(
    (
      await client.auth.signInWithPassword({
        email: 'admin.kalyani@login.shawarmania.invalid',
        password: 'shawarmania-local',
      })
    ).error,
  ).toBeNull()
  const adapter = createSupabaseMenuAdapter(client)
  const original = await adapter.presentation!.readHighlights(outlet)
  const menu = await adapter.listMenu(outlet)
  const category = menu.find((entry) => entry.items.some((item) => item.id === classic))!
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    await page.goto('sign-in')
    await page.getByLabel('Username or email', { exact: true }).fill('admin.kalyani')
    await page.getByLabel('Password').fill('shawarmania-local')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible()
    await page.goto('admin/menu')
    await page.getByRole('button', { name: 'Edit highlights' }).click()
    await page.getByLabel('Section name').fill('Recommended')
    await page
      .getByRole('checkbox', { name: 'Highlight Classic Chicken Shawarma', exact: true })
      .setChecked(true)
    await page.getByRole('button', { name: 'Save highlights' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByTestId('menu-highlights')).toContainText('Recommended')
    await page
      .getByRole('button', { name: 'Actions for Classic Chicken Shawarma', exact: true })
      .click()
    await page.getByRole('button', { name: 'Move down', exact: true }).click()
    const expectedIds = category.items.map((item) => item.id)
    const index = expectedIds.indexOf(classic)
    ;[expectedIds[index], expectedIds[index + 1]] = [expectedIds[index + 1]!, expectedIds[index]!]
    await expect
      .poll(async () =>
        (await adapter.listMenu(outlet))
          .find((entry) => entry.category.id === category.category.id)!
          .items.map((item) => item.id),
      )
      .toEqual(expectedIds)
    for (const viewport of [
      { name: 'phone', width: 390, height: 844 },
      { name: 'tablet', width: 1080, height: 810 },
    ]) {
      await page.setViewportSize(viewport)
      for (const theme of ['light', 'dark']) {
        await page.evaluate((value) => localStorage.setItem('shawarmania.theme', value), theme)
        await page.reload()
        await expect(page.getByTestId('menu-highlights')).toContainText('Recommended')
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
        const rows = page.getByTestId(`category-${category.category.id}`).locator('li')
        await expect(rows.nth(index + 1)).toContainText('Classic Chicken Shawarma')
        await expect(
          page
            .getByTestId(`menu-item-${classic}`)
            .getByRole('img', { name: 'Highlighted', exact: true }),
        ).toBeVisible()
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          ),
        ).toBeLessThanOrEqual(1)
        await page.screenshot({
          path: testInfo.outputPath(`live-menu-${viewport.name}-${theme}.png`),
          fullPage: true,
        })
      }
    }
    expect(errors).toEqual([])
  } finally {
    await adapter.presentation!.reorderItems(
      category.category.id,
      category.items.map((item) => item.id),
    )
    await adapter.presentation!.setHighlights(outlet, original)
    await client.auth.signOut()
  }
})
