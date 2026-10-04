/**
 * How an outlet serves, through the real adapter and over the wire
 * (each-outlet-chooses-how-it-serves, #60).
 *
 * `62_each_outlet_chooses_how_it_serves.sql` proves the checks and the narrow
 * function in SQL. What only a signed-in session over REST can show:
 *
 *   * **`set_outlet_service_settings` as a PostgREST RPC**, reached with the
 *     argument names the adapter sends, returning the row the adapter reads
 *     back — a wrong grant or a renamed argument fails only here;
 *   * **the refusal the adapter words**: it tells the rules apart by the check
 *     constraint Postgres names, so that name reaching the client is a contract.
 *
 * Requires the local stack: `npm run db:start && npm run db:reset`, then
 * `npm run test:rls`. Kalyani is put back to all-off, as the seed has it.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { DataActionError } from '../../../src/data-access/adapters'
import type { Database } from '../../../src/data-access/database.types'
import { createSupabaseMenuAdapter } from '../../../src/data-access/supabase-adapters/menu'
import { createSupabaseOutletsAdapter } from '../../../src/data-access/supabase-adapters/outlets'
import { ALL_OFF_SERVICE_SETTINGS, type OutletServiceSettings } from '../../../src/domain'

const SUPABASE_URL = process.env['SUPABASE_URL'] ?? 'http://127.0.0.1:54321'
const SUPABASE_ANON_KEY =
  process.env['SUPABASE_ANON_KEY'] ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

const SEED_PASSWORD = 'shawarmania-local'
const KALYANI = '00000000-0000-4000-a000-000000000001'

type Client = SupabaseClient<Database>

const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`

async function signIn(email: string): Promise<Client> {
  const client = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error } = await client.auth.signInWithPassword({ email, password: SEED_PASSWORD })
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`)
  return client
}

const EVERYTHING: OutletServiceSettings = {
  collectCustomerDetails: true,
  dineInOffered: true,
  takeawayOffered: true,
  tableNumbers: true,
  packagingMode: 'per_bag',
  packagingPricePaise: 500,
  packagingFreeForGold: true,
}

let ownerClient: Client
let owner: ReturnType<typeof createSupabaseOutletsAdapter>
let manager: ReturnType<typeof createSupabaseOutletsAdapter>
let throwaway: string

beforeAll(async () => {
  ownerClient = await signIn('owner@login.shawarmania.invalid')
  owner = createSupabaseOutletsAdapter(ownerClient)
  manager = createSupabaseOutletsAdapter(await signIn('admin.kalyani@login.shawarmania.invalid'))
  throwaway = (
    await owner.createOutlet({
      code: `serve-${RUN}`,
      name: 'Throwaway Serving Outlet',
      locationLabel: 'Created by the service settings suite',
    })
  ).id
})

afterAll(async () => {
  await owner.updateServiceSettings(KALYANI, { ...ALL_OFF_SERVICE_SETTINGS })
  await owner.deleteOutlet(throwaway)
})

describe('how an outlet serves, over REST', () => {
  it('starts a new outlet with nothing chosen', async () => {
    expect(await owner.getServiceSettings(throwaway)).toEqual(ALL_OFF_SERVICE_SETTINGS)
  })

  it('lets the owner choose everything, and reads every choice back', async () => {
    expect(await owner.updateServiceSettings(throwaway, EVERYTHING)).toEqual(EVERYTHING)
    expect(await owner.getServiceSettings(throwaway)).toEqual(EVERYTHING)
  })

  it('lets a manager choose for the outlet they manage', async () => {
    const flat: OutletServiceSettings = {
      ...EVERYTHING,
      collectCustomerDetails: false,
      tableNumbers: false,
      packagingMode: 'per_order',
      packagingPricePaise: 1000,
      packagingFreeForGold: false,
    }
    expect(await manager.updateServiceSettings(KALYANI, flat)).toEqual(flat)
    expect(await owner.getServiceSettings(KALYANI)).toEqual(flat)

    // And the outlet's tablet reads it with its menu, on the path it refreshes
    // and persists for a cold start offline (design D6).
    const tablet = createSupabaseMenuAdapter(
      await signIn('tablet.kalyani@login.shawarmania.invalid'),
    )
    expect((await tablet.readOutletMenu(KALYANI)).service).toEqual(flat)
  })

  it('refuses a manager at an outlet they do not manage, in a sentence', async () => {
    await expect(manager.updateServiceSettings(throwaway, EVERYTHING)).rejects.toMatchObject({
      code: 'not_permitted',
    })
    await expect(manager.updateServiceSettings(throwaway, EVERYTHING)).rejects.toBeInstanceOf(
      DataActionError,
    )
    // And reads it as an outlet that chose nothing, since they may read nothing of it.
    expect(await manager.getServiceSettings(throwaway)).toEqual(ALL_OFF_SERVICE_SETTINGS)
  })

  it('names the check that refused an inconsistent write, which is what the adapter words', async () => {
    const { error } = await ownerClient.rpc('set_outlet_service_settings', {
      p_outlet: throwaway,
      p_dine_in_offered: true,
      p_takeaway_offered: false,
      p_table_numbers: false,
      p_packaging_mode: 'per_bag',
      p_packaging_price_paise: 500,
      p_packaging_free_for_gold: false,
    })
    expect(error?.code).toBe('23514')
    expect(error?.message).toMatch(/check constraint "outlets_packaging_needs_takeaway"/)
  })
})
