import { execSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { Client as PgClient } from 'pg'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database, Tables } from '../../../src/data-access/database.types'
import { createSupabaseMenuAdapter } from '../../../src/data-access/supabase-adapters/menu'

const url = process.env['SUPABASE_URL'] ?? 'http://127.0.0.1:54321'
const localKeys = () =>
  JSON.parse(
    execSync('npx supabase status -o json', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  ) as { ANON_KEY: string; SERVICE_ROLE_KEY: string; DB_URL: string }
const outlet = '00000000-0000-4000-a000-000000000001'
const foreign = '00000000-0000-4000-a000-000000000002'
const classic = '31000000-0000-4000-a000-000000000001'
const salad = '31000000-0000-4000-a000-000000000005'
const foreignDish = '32000000-0000-4000-a000-000000000001'
type Client = SupabaseClient<Database>

async function closeFixtureSessions(clients: Client[]) {
  await Promise.all(
    clients.filter(Boolean).map((client) => client.auth.signOut({ scope: 'local' })),
  )
}

describe('live menu presentation over HTTP', () => {
  let owner: Client, manager: Client, biller: Client, employee: Client, service: Client
  let sections: Tables<'menu_highlight_sections'>[] = []
  let selections: Tables<'menu_highlight_items'>[] = []
  let fixtureReady = false

  beforeAll(async () => {
    // This fixture writes local seed outlets and restores their exact original
    // configuration. Never discover a hosted credential or run on a hosted URL.
    if (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) {
      throw new Error('menu presentation probes require the local Supabase stack')
    }
    const keys = localKeys()
    const client = (key: string) =>
      createClient<Database>(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    service = client(keys.SERVICE_ROLE_KEY)
    async function signIn(email: string) {
      const signedIn = client(keys.ANON_KEY)
      const { error } = await signedIn.auth.signInWithPassword({
        email,
        password: 'shawarmania-local',
      })
      if (error) throw new Error('local presentation persona could not sign in')
      return signedIn
    }
    ;[owner, manager, biller, employee] = await Promise.all([
      signIn('owner@login.shawarmania.invalid'),
      signIn('admin.kalyani@login.shawarmania.invalid'),
      signIn('biller.kalyani@login.shawarmania.invalid'),
      signIn('staff.kalyani@login.shawarmania.invalid'),
    ])
    const beforeSections = await service
      .from('menu_highlight_sections')
      .select('*')
      .in('outlet_id', [outlet, foreign])
    const beforeItems = await service
      .from('menu_highlight_items')
      .select('*')
      .in('outlet_id', [outlet, foreign])
    expect(beforeSections.error).toBeNull()
    expect(beforeItems.error).toBeNull()
    sections = beforeSections.data ?? []
    selections = beforeItems.data ?? []
    fixtureReady = true
    for (const [id, item] of [
      [outlet, classic],
      [foreign, foreignDish],
    ]) {
      const saved = await owner.rpc('set_menu_highlights', {
        p_outlet_id: id!,
        p_title: 'HTTP fixture',
        p_item_ids: [item!],
      })
      expect(saved.error).toBeNull()
    }
  })

  afterAll(async () => {
    try {
      if (fixtureReady) {
        const cleared = await service
          .from('menu_highlight_sections')
          .delete()
          .in('outlet_id', [outlet, foreign])
        expect(cleared.error).toBeNull()
        if (sections.length)
          expect((await service.from('menu_highlight_sections').insert(sections)).error).toBeNull()
        if (selections.length)
          expect((await service.from('menu_highlight_items').insert(selections)).error).toBeNull()
      }
    } finally {
      await closeFixtureSessions([owner, manager, biller, employee])
    }
  })

  it('closes fixture sessions without revoking another test’s owner session', async () => {
    const disposable = createClient<Database>(url, localKeys().ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    try {
      expect(
        (
          await disposable.auth.signInWithPassword({
            email: 'owner@login.shawarmania.invalid',
            password: 'shawarmania-local',
          })
        ).error,
      ).toBeNull()
      await closeFixtureSessions([disposable])
      expect((await owner.auth.getUser()).error).toBeNull()
    } finally {
      await closeFixtureSessions([disposable])
    }
  })

  it('round-trips the live adapter and keeps ordinary categories and prices intact', async () => {
    const adapter = createSupabaseMenuAdapter(manager)
    const before = await adapter.listMenu(outlet)
    const saved = { title: '  Newly Launched  ', itemIds: [salad, classic] }
    expect(await adapter.presentation!.setHighlights(outlet, saved)).toEqual({
      ...saved,
      title: 'Newly Launched',
    })
    expect(await adapter.presentation!.readHighlights(outlet)).toEqual({
      title: 'Newly Launched',
      itemIds: [salad, classic],
    })
    expect(await adapter.listMenu(outlet)).toEqual(before)
    const published = await service.rpc('public_menu', { p_slug: 'shawarmania-kalyani' })
    expect(published.error).toBeNull()
    const menu = published.data as { sections: { name: string; items: { name: string }[] }[] }
    expect(menu.sections[0]!.name).toBe('Newly Launched')
    expect(menu.sections[0]!.items.map((item) => item.name)).toEqual([
      'Healthy Chicken Shawarma Salad',
      'Classic Chicken Shawarma',
    ])
  })

  it('proves both foreign tables contain rows, then hides them from a real manager', async () => {
    for (const table of ['menu_highlight_sections', 'menu_highlight_items'] as const) {
      const positive = await owner.from(table).select('*').eq('outlet_id', foreign)
      expect(positive.error).toBeNull()
      expect(positive.data!.length).toBeGreaterThan(0)
      const denied = await manager.from(table).select('*').eq('outlet_id', foreign)
      expect(denied.error).toBeNull()
      expect(denied.data).toEqual([])
    }
    const read = await manager.rpc('read_menu_highlights', { p_outlet_id: foreign })
    expect(read.error?.code).toBe('42501')
  })

  it('refuses forged cross-outlet commands without changing the foreign configuration', async () => {
    const before = await owner.rpc('read_menu_highlights', { p_outlet_id: foreign })
    const write = await manager.rpc('set_menu_highlights', {
      p_outlet_id: foreign,
      p_title: 'Forged',
      p_item_ids: [],
    })
    expect(write.error?.code).toBe('42501')
    const reorder = await manager.rpc('reorder_menu_items', {
      p_category_id: '30000000-0000-4000-a000-000000000011',
      p_item_ids: [],
    })
    expect(reorder.error?.code).toBe('42501')
    expect((await owner.rpc('read_menu_highlights', { p_outlet_id: foreign })).data).toEqual(
      before.data,
    )
  })

  it('rejects duplicate and foreign dishes atomically with the existing selection intact', async () => {
    const before = await manager.rpc('read_menu_highlights', { p_outlet_id: outlet })
    for (const ids of [[classic, classic], [foreignDish]]) {
      const rejected = await manager.rpc('set_menu_highlights', {
        p_outlet_id: outlet,
        p_title: 'Rejected title',
        p_item_ids: ids,
      })
      expect(rejected.error?.code).toBe('22023')
      expect((await manager.rpc('read_menu_highlights', { p_outlet_id: outlet })).data).toEqual(
        before.data,
      )
    }
  })

  it('maps stale reorder refusal to visible refresh guidance and leaves positions intact', async () => {
    const adapter = createSupabaseMenuAdapter(manager)
    const before = await adapter.listMenu(outlet)
    await expect(
      adapter.presentation!.reorderItems(before[0]!.category.id, [classic]),
    ).rejects.toThrow('Refresh the menu')
    expect(await adapter.listMenu(outlet)).toEqual(before)
  })

  it('waits for a concurrent removal, then refuses the stale order without a partial write', async () => {
    const categoryId = randomUUID()
    const first = randomUUID(),
      second = randomUUID()
    const connection = new PgClient({ connectionString: localKeys().DB_URL })
    let transactionOpen = false
    let pending: Promise<{ error: unknown }> | undefined
    try {
      expect(
        (
          await service.from('menu_categories').insert({
            id: categoryId,
            outlet_id: outlet,
            name: `Race ${categoryId}`,
            sort_order: 999,
          })
        ).error,
      ).toBeNull()
      expect(
        (
          await service.from('menu_items').insert([
            {
              id: first,
              category_id: categoryId,
              outlet_id: outlet,
              name: 'First race dish',
              price_paise: 13900,
              sort_order: 7,
            },
            {
              id: second,
              category_id: categoryId,
              outlet_id: outlet,
              name: 'Second race dish',
              price_paise: 13900,
              sort_order: 9,
            },
          ])
        ).error,
      ).toBeNull()
      await connection.connect()
      await connection.query('begin')
      transactionOpen = true
      await connection.query('update public.menu_items set is_active=false where id=$1', [first])
      const holder = await connection.query<{ pid: number }>('select pg_backend_pid() as pid')
      pending = createSupabaseMenuAdapter(manager)
        .presentation!.reorderItems(categoryId, [second, first])
        .then(
          () => ({ error: null }),
          (error: unknown) => ({ error }),
        )
      await expect
        .poll(async () => {
          const waiting = await connection.query<{ count: number }>(
            'select count(*)::integer as count from pg_stat_activity where $1=any(pg_blocking_pids(pid))',
            [holder.rows[0]!.pid],
          )
          return waiting.rows[0]!.count
        })
        .toBeGreaterThan(0)
      await connection.query('commit')
      transactionOpen = false
      expect((await pending).error).toMatchObject({
        message: expect.stringContaining('Refresh the menu'),
      })
      const unchanged = await service
        .from('menu_items')
        .select('id,sort_order')
        .eq('category_id', categoryId)
        .order('sort_order')
      expect(unchanged.error).toBeNull()
      expect(unchanged.data).toEqual([
        { id: first, sort_order: 7 },
        { id: second, sort_order: 9 },
      ])
    } finally {
      if (transactionOpen) await connection.query('rollback')
      if (pending) await pending
      await connection.end()
      expect(
        (await service.from('menu_items').delete().eq('category_id', categoryId)).error,
      ).toBeNull()
      expect((await service.from('menu_categories').delete().eq('id', categoryId)).error).toBeNull()
    }
  })

  it('rejects bypass writes on each table and rejects both read-only roles at the RPC boundary', async () => {
    expect(
      (
        await manager
          .from('menu_highlight_sections')
          .update({ title: 'Bypass' })
          .eq('outlet_id', outlet)
      ).error?.code,
    ).toBe('42501')
    expect(
      (await manager.from('menu_highlight_items').delete().eq('outlet_id', outlet)).error?.code,
    ).toBe('42501')
    for (const client of [biller, employee]) {
      expect(
        (
          await client.rpc('set_menu_highlights', {
            p_outlet_id: outlet,
            p_title: 'Forged',
            p_item_ids: [],
          })
        ).error?.code,
      ).toBe('42501')
      expect(
        (
          await client.rpc('reorder_menu_items', {
            p_category_id: '30000000-0000-4000-a000-000000000001',
            p_item_ids: [],
          })
        ).error?.code,
      ).toBe('42501')
      for (const table of ['menu_highlight_sections', 'menu_highlight_items'] as const) {
        const denied = await client.from(table).select('*').eq('outlet_id', outlet)
        expect(denied.error).toBeNull()
        expect(denied.data).toEqual([])
      }
    }
  })
})
