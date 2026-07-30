import type {
  AccountsAdapter,
  AccountSummary,
  AppRole,
  IssuedCode,
  NewAccount,
  StaffFactsPatch,
} from '../adapters'
import { AccountActionError, liveAssignments } from '../adapters'
import { canonicalUsername } from '../../../shared/username'
import { accountFixtures, assignmentFixtures, PENDING_ACCOUNT_ID } from './fixtures/accounts'

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
 * A deterministic demo username from a demo name.
 */
function demoUsername(fullName: string): string {
  return fullName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.|\.$/g, '')
}

type DemoAccountEmailFixture = {
  superAdmin: string
  ordinaryAccount: null
}

/**
 * The fixture shape makes the product rule compile-time visible: the demo has
 * one invented Super Admin account email and no email for any
 * ordinary account.
 */
const DEMO_ACCOUNT_EMAILS = {
  superAdmin: 'owner.account@example.com',
  ordinaryAccount: null,
} as const satisfies DemoAccountEmailFixture

/** The demo's people list, shared by every surface that shows a person. */
export function createDemoAccounts(): AccountSummary[] {
  return accountFixtures.map((profile) => {
    const assignments = structuredClone(assignmentFixtures[profile.id] ?? [])
    const isOwner = liveAssignments(assignments).some(
      (assignment) => assignment.role === 'super_admin',
    )
    return {
      id: profile.id,
      fullName: profile.full_name,
      username: demoUsername(profile.full_name),
      accountEmail: isOwner ? DEMO_ACCOUNT_EMAILS.superAdmin : DEMO_ACCOUNT_EMAILS.ordinaryAccount,
      phone: profile.phone,
      isActive: profile.is_active,
      roleTitle: profile.role_title,
      assignments,
      invite: profile.id === PENDING_ACCOUNT_ID ? { expiresAt: inSevenDays() } : null,
    }
  })
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
      const username = requireAvailableUsername(account.username)
      const outletIds = account.role === 'super_admin' ? [null] : account.outletIds
      if (
        (account.role === 'super_admin' && account.outletIds.length > 0) ||
        (account.role !== 'super_admin' &&
          (outletIds.length === 0 || new Set(outletIds).size !== outletIds.length)) ||
        (account.role === 'super_admin' && !account.accountEmail?.trim()) ||
        (account.role !== 'super_admin' && account.accountEmail != null)
      ) {
        throw new AccountActionError('invalid_request', 'Choose at least one valid outlet.')
      }
      accounts.push({
        id,
        fullName: account.fullName,
        username,
        accountEmail:
          account.role === 'super_admin' ? account.accountEmail!.trim().toLowerCase() : null,
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
      return { profileId: id, username, code: demoCode(), expiresAt }
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
      if (
        (input.role === 'super_admin' && !input.accountEmail?.trim()) ||
        (input.role !== 'super_admin' && input.accountEmail != null)
      ) {
        throw new AccountActionError(
          'invalid_request',
          'A Super Admin assignment requires an email.',
        )
      }

      account.assignments.push({
        id: newAssignmentId(),
        role: input.role,
        outletId: input.outletId,
        startedOn: today(),
        endedOn: null,
      })
      if (input.role === 'super_admin') {
        account.accountEmail = input.accountEmail!.trim().toLowerCase()
      }
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

    async changeUsername(profileId: string, username: string) {
      if (profileId === viewerId) {
        throw new AccountActionError(
          'self_change_forbidden',
          'You cannot change your own username here.',
        )
      }
      const account = find(profileId)
      account.username = requireAvailableUsername(username, profileId)
      // The outstanding invite remains bound to the account UUID.
    },

    async setAccountEmail(profileId: string, accountEmail: string) {
      if (profileId === viewerId) {
        throw new AccountActionError(
          'self_change_forbidden',
          'You cannot change your own email here.',
        )
      }
      const account = find(profileId)
      if (!liveAssignments(account.assignments).some((a) => a.role === 'super_admin')) {
        throw new AccountActionError('forbidden', 'Only a Super Admin email can be changed here.')
      }
      const wanted = accountEmail.trim().toLowerCase()
      if (
        !wanted ||
        accounts.some(
          (candidate) => candidate.id !== profileId && candidate.accountEmail === wanted,
        )
      ) {
        throw new AccountActionError(
          'email_unavailable',
          'That email is already associated with another account.',
        )
      }
      account.accountEmail = wanted
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

  function requireAvailableUsername(input: string, exceptId?: string): string {
    const wanted = canonicalUsername(input)
    if (!wanted) {
      throw new AccountActionError('invalid_request', 'Enter a valid username.')
    }
    if (accounts.some((account) => account.id !== exceptId && account.username === wanted)) {
      throw new AccountActionError('username_unavailable', 'That username is already in use.')
    }
    return wanted
  }

  function replaceInvite(account: AccountSummary): IssuedCode {
    const expiresAt = inSevenDays()
    account.invite = { expiresAt }
    if (!account.username) {
      throw new AccountActionError('invalid_request', 'This account needs a username.')
    }
    return { profileId: account.id, username: account.username, code: demoCode(), expiresAt }
  }
}
