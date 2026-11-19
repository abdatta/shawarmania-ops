import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Page } from '@playwright/test'

import { expect, test } from './test'
import type { Database } from '../src/data-access/database.types'
import { createSupabaseMenuAdapter } from '../src/data-access/supabase-adapters/menu'

/**
 * Dish photos against a real backend (a-dish-can-show-its-photo, task 4.2):
 * a manager adds, adjusts, changes and removes a photo through the app; the
 * files land under the outlet's folder and the replaced ones go; another
 * outlet's manager is refused by storage and by the database; and the menu the
 * counter reads does not change. Holds only with `dish-photos` on.
 */

const KAL = '00000000-0000-4000-a000-000000000001'
const CLASSIC = '31000000-0000-4000-a000-000000000001'
const url = process.env['VITE_SUPABASE_URL'] ?? 'http://127.0.0.1:54321'
const anonKey =
  process.env['VITE_SUPABASE_ANON_KEY'] ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

async function signedIn(email: string): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error } = await client.auth.signInWithPassword({ email, password: 'shawarmania-local' })
  expect(error).toBeNull()
  return client
}

/** A camera-like JPEG drawn in the page. */
async function photo(page: Page, hue: number) {
  const base64 = await page.evaluate((hue) => {
    const canvas = document.createElement('canvas')
    canvas.width = 2000
    canvas.height = 1500
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = `hsl(${hue} 70% 40%)`
    ctx.fillRect(0, 0, 2000, 1500)
    ctx.fillStyle = `hsl(${hue + 40} 80% 60%)`
    ctx.beginPath()
    ctx.arc(1000, 750, 500, 0, 7)
    ctx.fill()
    return canvas.toDataURL('image/jpeg', 0.9).split(',')[1]!
  }, hue)
  return { name: 'dish.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(base64, 'base64') }
}

async function files(client: SupabaseClient<Database>) {
  const { data, error } = await client.storage.from('menu-photos').list(KAL, { limit: 100 })
  expect(error).toBeNull()
  return (data ?? []).map((file) => file.name).sort()
}

async function row(client: SupabaseClient<Database>) {
  const { data } = await client
    .from('menu_item_photos')
    .select('photo_key, photo_format, source_key, source_format, aspect')
    .eq('item_id', CLASSIC)
    .maybeSingle()
  return data
}

/**
 * The counter's menu with each dish's save time left out: every Save in the
 * editor re-saves the dish's own fields, as it always has, which stamps
 * `updated_at`. What must not change is anything the counter shows or prices
 * from. That a photo write leaves the dish row itself untouched is held by
 * pgTAP (99_a_dish_can_show_its_photo.sql).
 */
function withoutSaveStamps<T>(menu: T): T {
  return JSON.parse(JSON.stringify(menu), (key, value: unknown) =>
    key === 'updated_at' ? undefined : value,
  ) as T
}

async function openEditor(page: Page) {
  await page
    .getByRole('button', { name: 'Actions for Classic Chicken Shawarma', exact: true })
    .click()
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  const sheet = page.getByRole('dialog', { name: 'Edit Classic Chicken Shawarma' })
  await expect(sheet).toBeVisible()
  return sheet
}

test('a manager adds, adjusts, changes and removes a dish photo, and another outlet cannot touch it @cg-on:dish-photos', async ({
  page,
}) => {
  if (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname))
    throw new Error('This probe needs the local stack')
  const manager = await signedIn('admin.kalyani@login.shawarmania.invalid')
  const stranger = await signedIn('admin.kanchrapara@login.shawarmania.invalid')
  const counterMenu = withoutSaveStamps(
    await createSupabaseMenuAdapter(manager).readOutletMenu(KAL),
  )
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))

  try {
    await page.goto('sign-in')
    await page.getByLabel('Username or email', { exact: true }).fill('admin.kalyani')
    await page.getByLabel('Password').fill('shawarmania-local')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible()
    await page.goto('admin/menu')

    // Add.
    let sheet = await openEditor(page)
    await page.getByTestId('menu-photo-input').setInputFiles(await photo(page, 20))
    await expect(page.getByTestId('photo-cropper')).toBeVisible()
    await page.getByRole('button', { name: 'Done' }).click()
    await sheet.getByRole('button', { name: 'Save changes' }).click()
    await expect(sheet).toBeHidden()
    await expect(page.getByTestId(`menu-photo-row-${CLASSIC}`)).toBeVisible()
    const added = (await row(manager))!
    expect(added.aspect).toBe('4:3')
    const ext = added.photo_format
    expect(await files(manager)).toEqual(
      [
        `${added.photo_key}-sm.${ext}`,
        `${added.photo_key}.${ext}`,
        `${added.source_key}-src.${added.source_format}`,
      ].sort(),
    )

    // Another outlet's manager: refused by storage and by the database.
    const path = `${KAL}/${added.photo_key}.${ext}`
    expect((await stranger.storage.from('menu-photos').download(path)).error).not.toBeNull()
    await stranger.storage.from('menu-photos').remove([path])
    expect(await files(manager)).toContain(`${added.photo_key}.${ext}`)
    expect(
      (
        await stranger.storage
          .from('menu-photos')
          .upload(`${KAL}/${'e'.repeat(64)}.webp`, new Blob(['x'], { type: 'image/webp' }))
      ).error,
    ).not.toBeNull()
    expect((await stranger.rpc('clear_menu_item_photo', { p_item_id: CLASSIC })).error?.code).toBe(
      '42501',
    )
    expect(
      (await stranger.from('menu_item_photos').select('item_id').eq('item_id', CLASSIC)).data,
    ).toEqual([])

    // Adjust: a new framing is a new pair; the original stays.
    sheet = await openEditor(page)
    await sheet.getByRole('button', { name: 'Adjust' }).click()
    await page.getByRole('button', { name: 'Square, 1:1' }).click()
    await page.getByRole('button', { name: 'Done' }).click()
    await sheet.getByRole('button', { name: 'Save changes' }).click()
    await expect(sheet).toBeHidden()
    const adjusted = (await row(manager))!
    expect(adjusted.aspect).toBe('1:1')
    expect(adjusted.photo_key).not.toBe(added.photo_key)
    expect(adjusted.source_key).toBe(added.source_key)
    await expect
      .poll(() => files(manager))
      .toEqual(
        [
          `${adjusted.photo_key}-sm.${ext}`,
          `${adjusted.photo_key}.${ext}`,
          `${added.source_key}-src.${added.source_format}`,
        ].sort(),
      )

    // Change: a new photo, so a new original too, and the old one goes.
    sheet = await openEditor(page)
    const chooser = page.waitForEvent('filechooser')
    await sheet.getByRole('button', { name: 'Change', exact: true }).click()
    await (await chooser).setFiles(await photo(page, 200))
    await page.getByRole('button', { name: 'Done' }).click()
    await sheet.getByRole('button', { name: 'Save changes' }).click()
    await expect(sheet).toBeHidden()
    const changed = (await row(manager))!
    expect(changed.source_key).not.toBe(added.source_key)
    await expect.poll(() => files(manager)).toHaveLength(3)
    expect(await files(manager)).toContain(`${changed.source_key}-src.${changed.source_format}`)

    // The saved photo opens enlarged from its row.
    await page.getByRole('button', { name: 'Photo of Classic Chicken Shawarma' }).click()
    await expect(
      page
        .getByRole('dialog', { name: 'Photo of Classic Chicken Shawarma' })
        .getByTestId('viewer-large'),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Close' }).click()

    // Remove: the row and the files go.
    sheet = await openEditor(page)
    await sheet.getByRole('button', { name: 'Remove' }).click()
    await sheet.getByRole('button', { name: 'Save changes' }).click()
    await expect(sheet).toBeHidden()
    expect(await row(manager)).toBeNull()
    await expect.poll(() => files(manager)).toEqual([])
    await expect(page.getByTestId(`menu-photo-row-${CLASSIC}`)).toHaveCount(0)

    // None of it reached the menu the counter reads.
    expect(withoutSaveStamps(await createSupabaseMenuAdapter(manager).readOutletMenu(KAL))).toEqual(
      counterMenu,
    )
    expect(errors).toEqual([])
  } finally {
    await manager.rpc('clear_menu_item_photo', { p_item_id: CLASSIC })
    const left = await files(manager)
    if (left.length > 0) {
      await manager.storage.from('menu-photos').remove(left.map((name) => `${KAL}/${name}`))
    }
    await manager.auth.signOut()
    await stranger.auth.signOut()
  }
})
