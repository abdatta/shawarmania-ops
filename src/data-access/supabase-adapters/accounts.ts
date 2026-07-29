import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'

import {
  AccountActionError,
  type AccountSummary,
  type AccountsAdapter,
  type AppRole,
  type IssuedCode,
  type NewAccount,
  type StaffFactsPatch,
} from '../adapters'
import { failureCode } from '../auth'
import type { Database } from '../database.types'

/**
 * The real accounts adapter.
 *
 * Reads come straight from the tables under RLS — the Super Admin's query and
 * the Franchise Admin's are literally the same query, and the database returns
 * different rows. Identity and access writes go to the `admin-accounts` Edge
 * Function, because creating an auth user needs the service-role key and that
 * key never reaches a browser. Staff facts are the exception: they are the
 * admin's own RLS write, exactly as roster edits were before the merge.
 */

// The assignments come back embedded rather than in a second query: a person
// and where they work are one answer to one question, and two round trips
// would let the list render somebody whose placement had not arrived yet.
const PROFILE_COLUMNS =
  'id, full_name, phone, is_active, role_title, ' +
  'assignments(id, role, outlet_id, started_on, ended_on)'

interface AssignmentRow {
  id: string
  role: AppRole
  outlet_id: string | null
  started_on: string
  ended_on: string | null
}

interface ProfileRow {
  id: string
  full_name: string
  phone: string | null
  is_active: boolean
  role_title: string | null
  assignments: AssignmentRow[] | null
}

/**
 * Turn a Postgres refusal into something worth reading. The trigger and
 * constraint names are the contract — they are what the schema chose to call
 * these rules, and matching on them beats matching on prose.
 */
function toStaffFactsError(error: PostgrestError): AccountActionError {
  const detail = `${error.message} ${error.details ?? ''}`

  if (detail.includes('profiles_full_name_not_blank')) {
    return new AccountActionError('name_required', 'A person needs a name.')
  }
  if (error.code === '42501') {
    return new AccountActionError('forbidden', 'You are not allowed to do that for this account.')
  }
  return new AccountActionError('failed', 'That did not work. Try again in a moment.')
}

// Never `select('*')`: the invite table withholds code_hash by column grant,
// so a whole-row read is refused by design. Naming columns is the contract.
const INVITE_COLUMNS = 'profile_id, expires_at, consumed_at, superseded_at'

const MESSAGES: Record<string, string> = {
  forbidden: 'You are not allowed to do that for this account.',
  already_assigned: 'This person already works at that outlet.',
  last_super_admin: 'There has to be an owner. Appoint another one before removing this.',
  assignment_rejected: 'That role and outlet do not go together.',
  email_unavailable: 'That email address already has an account.',
  too_many_accounts: 'There are more accounts than this screen can list. Tell somebody.',
  invalid_request: 'Something in that form was missing or malformed.',
  not_found: 'That account no longer exists.',
  unauthorised: 'Your session is no longer valid. Sign in again.',
}

interface AssignmentChangeResponse {
  assignmentId: string
  issuedCode: IssuedCode | null
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
  const toSummary = (
    profile: ProfileRow,
    email: string | null,
    invite: { expiresAt: string } | null,
  ): AccountSummary => ({
    id: profile.id,
    fullName: profile.full_name,
    email,
    phone: profile.phone,
    isActive: profile.is_active,
    roleTitle: profile.role_title,
    assignments: (profile.assignments ?? []).map((a) => ({
      id: a.id,
      role: a.role,
      outletId: a.outlet_id,
      startedOn: a.started_on,
      endedOn: a.ended_on,
    })),
    invite,
  })

  return {
    async listAccounts(): Promise<AccountSummary[]> {
      const [{ data: profiles, error }, { data: invites, error: inviteError }, addresses] =
        await Promise.all([
          client.from('profiles').select(PROFILE_COLUMNS).order('full_name'),
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

      return ((profiles ?? []) as unknown as ProfileRow[]).map((profile) =>
        toSummary(profile, addresses[profile.id] ?? null, outstanding.get(profile.id) ?? null),
      )
    },

    async provision(account: NewAccount): Promise<IssuedCode> {
      return await callAdmin<IssuedCode>(client, {
        action: 'provision',
        fullName: account.fullName,
        email: account.email,
        phone: account.phone ?? null,
        role: account.role,
        outletIds: account.outletIds,
        roleTitle: account.roleTitle ?? null,
        joinedOn: account.joinedOn ?? null,
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
     * Placing a person, and un-placing them. Privileged for the same reason
     * provisioning is: the authority is re-derived from the caller's own token,
     * never from what the request says about itself. The database enforces the
     * identical rule underneath — this seam only makes the refusal legible.
     */
    async grantAssignment(input: {
      personId: string
      role: AppRole
      outletId: string | null
    }): Promise<IssuedCode | null> {
      const result = await callAdmin<AssignmentChangeResponse>(client, {
        action: 'assign',
        personId: input.personId,
        role: input.role,
        outletId: input.outletId,
      })
      return result.issuedCode
    },

    async endAssignment(assignmentId: string): Promise<IssuedCode | null> {
      const result = await callAdmin<AssignmentChangeResponse>(client, {
        action: 'end-assignment',
        assignmentId,
      })
      return result.issuedCode
    },

    /**
     * The one account write that is not privileged: staff facts belong to the
     * admin's own session under RLS, exactly as roster edits always did. The
     * database is the boundary for every rule here — cross-outlet reach, the
     * owner-only staff code, the not-blank checks.
     */
    async updateStaffFacts(profileId: string, patch: StaffFactsPatch): Promise<AccountSummary> {
      const { data, error } = await client
        .from('profiles')
        .update({
          ...(patch.fullName !== undefined && { full_name: patch.fullName }),
          ...(patch.roleTitle !== undefined && { role_title: patch.roleTitle }),
        })
        .eq('id', profileId)
        .select(PROFILE_COLUMNS)
        .maybeSingle()
      if (error) throw toStaffFactsError(error)
      if (!data) {
        // Zero rows back is what "RLS filtered it out" looks like from here.
        throw new AccountActionError(
          'forbidden',
          'You are not allowed to do that for this account.',
        )
      }
      return toSummary(data as unknown as ProfileRow, null, null)
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
