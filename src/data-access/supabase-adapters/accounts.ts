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
const INVITE_COLUMNS = 'profile_id, expires_at, consumed_at, superseded_at'

const MESSAGES: Record<string, string> = {
  forbidden: 'You are not allowed to do that for this account.',
  email_unavailable: 'That email address already has an account.',
  too_many_accounts: 'There are more accounts than this screen can list. Tell somebody.',
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
      const [{ data: profiles, error }, { data: invites, error: inviteError }, addresses] =
        await Promise.all([
          client
            .from('profiles')
            .select('id, full_name, phone, role, outlet_id, is_active')
            .order('full_name'),
          client.from('account_invites').select(INVITE_COLUMNS),
          // The one field RLS cannot serve: the address lives in `auth.users`,
          // deliberately not mirrored onto `profiles` where a Biller could read
          // their whole outlet's (design D12). A refusal or an outage here
          // costs the addresses and not the screen.
          callAdmin<{ emails: Record<string, string> }>(client, { action: 'emails' })
            .then((result) => result.emails)
            .catch(() => ({}) as Record<string, string>),
        ])
      if (error) throw error
      if (inviteError) throw inviteError

      const outstanding = new Map(
        (invites ?? [])
          .filter((invite) => invite.consumed_at === null && invite.superseded_at === null)
          .map((invite) => [invite.profile_id, { expiresAt: invite.expires_at }]),
      )

      return (profiles ?? []).map((profile) => ({
        id: profile.id,
        fullName: profile.full_name,
        email: addresses[profile.id] ?? null,
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

    async changeEmail(profileId: string, email: string): Promise<void> {
      await callAdmin(client, { action: 'set-email', profileId, email: email.trim() })
    },

    /**
     * How hard the activation endpoint is being hammered right now.
     *
     * A plain RPC rather than a trip through the privileged function: the
     * database already knows the caller's role from their token, and the
     * function refuses anyone who is not the Super Admin. Null when they may
     * not ask — which is every other role, and is not an error worth a banner.
     */
    async failedActivations(): Promise<number | null> {
      const { data, error } = await client.rpc('invite_failure_pressure')
      if (error) return null
      return typeof data === 'number' ? data : null
    },
  }
}
