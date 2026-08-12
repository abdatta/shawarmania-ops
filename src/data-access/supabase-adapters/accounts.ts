import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'

import {
  AccountActionError,
  deriveAccountLifecycle,
  type AccountSummary,
  type AccountsAdapter,
  type AccountHandover,
  type AppRole,
  type Assignment,
  type AssignmentSetResult,
  type EditAccountCommand,
  type IssuedCode,
  type NewAccount,
  type StaffFactsPatch,
} from '../adapters'
import { failureCode } from '../auth'
import type { Database } from '../database.types'
import { signalHumanSessionInvalid } from '../../session/human-session-invalid'

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

const MESSAGES: Record<string, string> = {
  forbidden: 'You are not allowed to do that for this account.',
  already_assigned: 'This person already works at that outlet.',
  last_super_admin: 'There has to be an owner. Appoint another one before removing this.',
  assignment_rejected: 'That role and outlet do not go together.',
  username_unavailable: 'That username is already in use.',
  email_unavailable: 'That email is already associated with another account.',
  self_change_forbidden: 'You cannot change your own username or email here.',
  too_many_accounts: 'There are more accounts than this screen can list. Tell somebody.',
  invalid_request: 'Something in that form was missing or malformed.',
  not_found: 'That account no longer exists.',
  session_invalid: 'Your session is no longer valid. Sign in again.',
  stale_edit: 'This account changed while you were editing it. Review the latest details.',
  account_inactive: 'Reactivate this account before issuing a link.',
}

interface AssignmentChangeResponse {
  assignmentId: string
  issuedCode: IssuedCode | null
}

interface AssignmentSetWireResult {
  profileId: string
  assignments: Array<{
    id: string
    role: AppRole
    outletId: string | null
    startedOn: string
    endedOn: string | null
  }>
  stateFingerprint: string
  replacementHandover: AccountHandover | null
}

function assignmentSetResult(result: AssignmentSetWireResult): AssignmentSetResult {
  return {
    profileId: result.profileId,
    assignments: result.assignments.map((assignment): Assignment => ({
      id: assignment.id,
      role: assignment.role,
      outletId: assignment.outletId,
      startedOn: assignment.startedOn,
      endedOn: assignment.endedOn,
    })),
    stateFingerprint: result.stateFingerprint,
    replacementHandover: result.replacementHandover,
  }
}

async function callAdmin<T>(
  client: SupabaseClient<Database>,
  body: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await client.functions.invoke('admin-accounts', { body })
  if (!error) return data as T

  const code = (await failureCode(error)) ?? 'unavailable'
  if (code === 'session_invalid') signalHumanSessionInvalid()
  throw new AccountActionError(code, MESSAGES[code] ?? 'That did not work. Try again in a moment.')
}

export function createSupabaseAccountsAdapter(client: SupabaseClient<Database>): AccountsAdapter {
  type IdentifierFacts = {
    username: string | null
    accountEmail: string | null
    hasSignedIn: boolean
    invite: { purpose: 'activation' | 'password_reset'; expiresAt: string } | null
    stateFingerprint: string
  }

  const toSummary = (profile: ProfileRow, identifier: IdentifierFacts): AccountSummary => {
    const facts = {
      isActive: profile.is_active,
      hasSignedIn: identifier.hasSignedIn,
      invite: identifier.invite,
    }
    return {
      id: profile.id,
      fullName: profile.full_name,
      username: identifier.username,
      accountEmail: identifier.accountEmail,
      phone: profile.phone,
      isActive: profile.is_active,
      hasSignedIn: identifier.hasSignedIn,
      roleTitle: profile.role_title,
      assignments: (profile.assignments ?? []).map((a) => ({
        id: a.id,
        role: a.role,
        outletId: a.outlet_id,
        startedOn: a.started_on,
        endedOn: a.ended_on,
      })),
      invite: identifier.invite,
      lifecycle: deriveAccountLifecycle(facts),
      stateFingerprint: identifier.stateFingerprint,
    }
  }

  return {
    async listAccounts(): Promise<AccountSummary[]> {
      const [{ data: profiles, error }, { identifiers }] = await Promise.all([
        client.from('profiles').select(PROFILE_COLUMNS).order('full_name'),
        callAdmin<{ identifiers: Record<string, IdentifierFacts> }>(client, {
          action: 'identifiers',
        }),
      ])
      if (error) throw error

      return ((profiles ?? []) as unknown as ProfileRow[])
        .filter((profile) => identifiers[profile.id] !== undefined)
        .map((profile) => toSummary(profile, identifiers[profile.id]!))
    },

    async provision(account: NewAccount): Promise<IssuedCode> {
      return await callAdmin<IssuedCode>(client, {
        action: 'provision',
        fullName: account.fullName,
        username: account.username,
        accountEmail: account.accountEmail ?? null,
        phone: account.phone ?? null,
        role: account.role,
        outletIds: account.outletIds,
        roleTitle: account.roleTitle ?? null,
        joinedOn: account.joinedOn ?? null,
      })
    },

    async issueHandover(profileId: string): Promise<AccountHandover> {
      return await callAdmin<AccountHandover>(client, {
        action: 'issue-handover',
        profileId,
      })
    },

    async editAccount(command: EditAccountCommand): Promise<AssignmentSetResult> {
      const result = await callAdmin<AssignmentSetWireResult>(client, {
        action: 'edit-account',
        profileId: command.profileId,
        expectedStateFingerprint: command.expectedStateFingerprint,
        fullName: command.fullName,
        phone: command.phone,
        roleTitle: command.roleTitle,
        accountEmail: command.accountEmail,
        assignments: command.assignments,
      })
      return assignmentSetResult(result)
    },

    async markAsLeft(
      profileId: string,
      expectedStateFingerprint: string,
    ): Promise<AssignmentSetResult> {
      const result = await callAdmin<AssignmentSetWireResult>(client, {
        action: 'mark-as-left',
        profileId,
        expectedStateFingerprint,
      })
      return assignmentSetResult(result)
    },

    async reissue(profileId: string): Promise<IssuedCode> {
      return await callAdmin<IssuedCode>(client, { action: 'reissue', profileId })
    },

    async setActive(profileId: string, isActive: boolean): Promise<void> {
      await callAdmin(client, { action: 'set-active', profileId, isActive })
    },

    async changeUsername(profileId: string, username: string): Promise<void> {
      await callAdmin(client, {
        action: 'set-username',
        profileId,
        username: username.trim(),
      })
    },

    async setAccountEmail(profileId: string, accountEmail: string): Promise<void> {
      await callAdmin(client, {
        action: 'set-account-email',
        profileId,
        accountEmail: accountEmail.trim(),
      })
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
      accountEmail?: string | null
    }): Promise<IssuedCode | null> {
      const result = await callAdmin<AssignmentChangeResponse>(client, {
        action: 'assign',
        personId: input.personId,
        role: input.role,
        outletId: input.outletId,
        accountEmail: input.accountEmail ?? null,
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
      const { identifiers } = await callAdmin<{
        identifiers: Record<string, IdentifierFacts>
      }>(client, { action: 'identifiers' })
      const facts = identifiers[profileId]
      if (!facts) {
        throw new AccountActionError(
          'forbidden',
          'You are not allowed to do that for this account.',
        )
      }
      return toSummary(data as unknown as ProfileRow, facts)
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
