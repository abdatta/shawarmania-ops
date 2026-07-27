import type { SupabaseClient } from '@supabase/supabase-js'

import {
  AccountActionError,
  type AccountSummary,
  type AccountsAdapter,
  type AppRole,
  type IssuedCode,
  type NewAccount,
} from '../adapters'
import { failureCode } from '../auth'
import type { Database } from '../database.types'

/**
 * The real accounts adapter.
 *
 * Reads come straight from the tables under RLS — the Super Admin's query and
 * the Franchise Admin's are literally the same query, and the database returns
 * different rows. Writes go to the `admin-accounts` Edge Function, because
 * creating an auth user needs the service-role key and that key never reaches
 * a browser.
 */

// Never `select('*')`: the invite table withholds code_hash by column grant,
// so a whole-row read is refused by design. Naming columns is the contract.
const INVITE_COLUMNS = 'profile_id, expires_at, attempts, consumed_at, superseded_at'

const MESSAGES: Record<string, string> = {
  forbidden: 'You are not allowed to do that for this account.',
  email_unavailable: 'That email address already has an account.',
  invalid_request: 'Something in that form was missing or malformed.',
  not_found: 'That account no longer exists.',
  unauthorised: 'Your session is no longer valid. Sign in again.',
}

async function callAdmin<T>(
  client: SupabaseClient<Database>,
  body: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await client.functions.invoke('admin-accounts', { body })
  if (!error) return data as T

  const code = (await failureCode(error)) ?? 'unavailable'
  throw new AccountActionError(code, MESSAGES[code] ?? 'That did not work. Try again in a moment.')
}

export function createSupabaseAccountsAdapter(client: SupabaseClient<Database>): AccountsAdapter {
  return {
    async listAccounts(): Promise<AccountSummary[]> {
      const [{ data: profiles, error }, { data: invites, error: inviteError }] = await Promise.all([
        client
          .from('profiles')
          .select('id, full_name, phone, role, outlet_id, is_active')
          .order('full_name'),
        client.from('account_invites').select(INVITE_COLUMNS),
      ])
      if (error) throw error
      if (inviteError) throw inviteError

      const outstanding = new Map(
        (invites ?? [])
          .filter((invite) => invite.consumed_at === null && invite.superseded_at === null)
          .map((invite) => [
            invite.profile_id,
            { expiresAt: invite.expires_at, attempts: invite.attempts },
          ]),
      )

      return (profiles ?? []).map((profile) => ({
        id: profile.id,
        fullName: profile.full_name,
        phone: profile.phone,
        role: profile.role as AppRole,
        outletId: profile.outlet_id,
        isActive: profile.is_active,
        invite: outstanding.get(profile.id) ?? null,
      }))
    },

    async provision(account: NewAccount): Promise<IssuedCode> {
      return await callAdmin<IssuedCode>(client, {
        action: 'provision',
        fullName: account.fullName,
        email: account.email,
        phone: account.phone ?? null,
        role: account.role,
        outletId: account.outletId,
      })
    },

    async reissue(profileId: string): Promise<IssuedCode> {
      return await callAdmin<IssuedCode>(client, { action: 'reissue', profileId })
    },

    async setActive(profileId: string, isActive: boolean): Promise<void> {
      await callAdmin(client, { action: 'set-active', profileId, isActive })
    },
  }
}
