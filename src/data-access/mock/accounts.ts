import type {
  AccountsAdapter,
  AccountSummary,
  AppRole,
  IssuedCode,
  NewAccount,
  StaffFactsPatch,
} from '../adapters'
import { AccountActionError, liveAssignments } from '../adapters'
import {
  accountFixtures,
  assignmentFixtures,
  DEMO_HELPER_ACCOUNT_ID,
  PENDING_ACCOUNT_ID,
} from './fixtures/accounts'

/**
 * The mock accounts adapter. Fixtures in, promises out, no I/O anywhere — the
 * demo tree is structurally incapable of reaching Supabase (design D4).
 *
 * Unlike the outlets mock this one holds state, because the surface it serves
 * is about *doing* things: creating a person in a demo has to show a row
 * appearing and a code coming back, or the demo is a screenshot. The state
 * dies with the demo tree and never outlives a walkthrough.
 *
 * The list is created separately and handed in, because the attendance
 * surfaces read people from it too: a person renamed on People has to read
 * the same everywhere in the same walkthrough.
 */

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/**
 * A code shaped exactly like a real one, from Math.random rather than a CSPRNG
 * — which is correct here and only here: it protects nothing, because nothing
 * in demo mode exists to protect.
 */
function demoCode(): string {
  const chars = Array.from(
    { length: 10 },
    () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)],
  )
  return `${chars.slice(0, 5).join('')}-${chars.slice(5).join('')}`
}

function inSevenDays(): string {
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * A demo address from a demo name. `example.com` is reserved for exactly this
 * (RFC 2606) and can never reach a real inbox — fixtures never carry anything
 * that could read as a real person's contact detail (docs/DEMO_MODE.md).
 */
function demoEmail(fullName: string): string {
  const local = fullName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.|\.$/g, '')
  return `${local}@example.com`
}

/** The demo's people list, shared by every surface that shows a person. */
export function createDemoAccounts(): AccountSummary[] {
  return accountFixtures.map((profile) => ({
    id: profile.id,
    fullName: profile.full_name,
    // Demo Helper carries the address the roster merge would have minted —
    // the reserved `.invalid` domain, unroutable by design — so the People
    // surface has the "fix the address first" state to show.
    email:
      profile.id === DEMO_HELPER_ACCOUNT_ID
        ? `${profile.id}@placeholder.invalid`
        : demoEmail(profile.full_name),
    phone: profile.phone,
    isActive: profile.is_active,
    roleTitle: profile.role_title,
    assignments: structuredClone(assignmentFixtures[profile.id] ?? []),
    invite: profile.id === PENDING_ACCOUNT_ID ? { expiresAt: inSevenDays() } : null,
  }))
}

export function createMockAccountsAdapter(
  accounts: AccountSummary[],
  /**
   * Who is looking. The self-assignment carve-out is owner-only and the demo
   * must refuse a manager the same way the database does — a demo that let one
   * through would teach a product this one is not. Defaults to the owner,
   * which is the unrestricted case and what a test wants unless it says
   * otherwise.
   */
  role: AppRole = 'super_admin',
  /**
   * Which row is the viewer's own. The carve-out is a rule about *yourself*,
   * so the mock has to know which person that is.
   */
  viewerId: string | null = null,
): AccountsAdapter {
  const find = (profileId: string): AccountSummary => {
    const account = accounts.find((candidate) => candidate.id === profileId)
    if (!account) throw new Error(`No demo account: ${profileId}`)
    return account
  }

  let nextId = 1
  let nextAssignmentId = 1

  function newAssignmentId(): string {
    return `da000000-0000-4000-b000-${String(nextAssignmentId++).padStart(12, '0')}`
  }

  return {
    async listAccounts() {
      return structuredClone(accounts)
    },

    async provision(account: NewAccount): Promise<IssuedCode> {
      const id = `d1000000-0000-4000-b000-${String(nextId++).padStart(12, '0')}`
      const expiresAt = inSevenDays()
      refuseTakenEmail(account.email)
      const outletIds = account.role === 'super_admin' ? [null] : account.outletIds
      if (
        (account.role === 'super_admin' && account.outletIds.length > 0) ||
        (account.role !== 'super_admin' &&
          (outletIds.length === 0 || new Set(outletIds).size !== outletIds.length))
      ) {
        throw new AccountActionError('invalid_request', 'Choose at least one valid outlet.')
      }
      accounts.push({
        id,
        fullName: account.fullName,
        email: account.email.trim().toLowerCase(),
        phone: account.phone ?? null,
        isActive: true,
        roleTitle: account.roleTitle ?? null,
        // One act: account, every placement, then the one code returned below.
        assignments: outletIds.map((outletId) => ({
          id: newAssignmentId(),
          role: account.role,
          outletId,
          startedOn: account.joinedOn ?? today(),
          endedOn: null,
        })),
        invite: { expiresAt },
      })
      return { profileId: id, code: demoCode(), expiresAt }
    },

    /**
     * Placing somebody, refusing what the database refuses: a second live
     * assignment at an outlet they already work at, and both halves of the
     * self-assignment rule (design D7).
     */
    async grantAssignment(input) {
      const account = find(input.personId)
      const hadInvite = account.invite !== null

      if (viewerId !== null && input.personId === viewerId) {
        if (input.role === 'super_admin') {
          throw new AccountActionError('forbidden', 'Nobody can give themselves the owner role.')
        }
        if (role !== 'super_admin') {
          throw new AccountActionError(
            'forbidden',
            'Only the owner can assign themselves to an outlet.',
          )
        }
      }

      if (
        liveAssignments(account.assignments).some(
          (existing) => existing.outletId === input.outletId,
        )
      ) {
        throw new AccountActionError(
          'already_assigned',
          'This person already works at that outlet.',
        )
      }

      account.assignments.push({
        id: newAssignmentId(),
        role: input.role,
        outletId: input.outletId,
        startedOn: today(),
        endedOn: null,
      })
      return hadInvite ? replaceInvite(account) : null
    },

    /** Ending a placement: a date, never a removal, and never the last owner. */
    async endAssignment(assignmentId: string) {
      for (const account of accounts) {
        const assignment = account.assignments.find((candidate) => candidate.id === assignmentId)
        if (!assignment || assignment.endedOn !== null) continue
        const hadInvite = account.invite !== null

        if (assignment.role === 'super_admin') {
          const anotherOwnerExists = accounts.some((other) =>
            liveAssignments(other.assignments).some(
              (live) => live.role === 'super_admin' && live.id !== assignmentId,
            ),
          )
          if (!anotherOwnerExists) {
            throw new AccountActionError(
              'last_super_admin',
              'There has to be an owner. Appoint another one before removing this.',
            )
          }
        }

        assignment.endedOn = today()
        return hadInvite ? replaceInvite(account) : null
      }
      throw new AccountActionError('not_found', 'That assignment no longer exists.')
    },

    async reissue(profileId: string): Promise<IssuedCode> {
      const account = find(profileId)
      return replaceInvite(account)
    },

    async setActive(profileId: string, isActive: boolean) {
      find(profileId).isActive = isActive
    },

    async changeEmail(profileId: string, email: string) {
      const account = find(profileId)
      refuseTakenEmail(email, profileId)
      account.email = email.trim().toLowerCase()
      // The outstanding invite is untouched on purpose: a code is bound to the
      // account, not the address, and cancelling it would invalidate a message
      // the admin has already sent (design D13).
    },

    /**
     * The staff-fact edit — what is left of it now that placement has its own
     * relation: a person's name, and what they do. The database refuses a
     * blank name, and so does this.
     */
    async updateStaffFacts(profileId: string, patch: StaffFactsPatch) {
      const account = find(profileId)
      if (patch.fullName !== undefined && patch.fullName.trim() === '') {
        throw new AccountActionError('name_required', 'A person needs a name.')
      }
      Object.assign(account, {
        ...(patch.fullName !== undefined && { fullName: patch.fullName }),
        ...(patch.roleTitle !== undefined && { roleTitle: patch.roleTitle }),
      })
      return structuredClone(account)
    },

    /**
     * A demo is a quiet Tuesday, not an incident: below the notice threshold,
     * so the banner it would otherwise trigger stays where it belongs — on the
     * one screen that is genuinely being attacked.
     */
    async failedActivations() {
      return 2
    },
  }

  function refuseTakenEmail(email: string, exceptId?: string) {
    const wanted = email.trim().toLowerCase()
    if (accounts.some((account) => account.id !== exceptId && account.email === wanted)) {
      throw new AccountActionError(
        'email_unavailable',
        'That email address already has an account.',
      )
    }
  }

  function replaceInvite(account: AccountSummary): IssuedCode {
    const expiresAt = inSevenDays()
    account.invite = { expiresAt }
    return { profileId: account.id, code: demoCode(), expiresAt }
  }
}
