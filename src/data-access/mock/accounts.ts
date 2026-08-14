import type {
  AccountHandover,
  AccountInvitePurpose,
  AccountsAdapter,
  AccountSummary,
  AppRole,
  Assignment,
  AssignmentSetResult,
  EditAccountCommand,
  IssuedCode,
  NewAccount,
  StaffFactsPatch,
} from '../adapters'
import {
  AccountActionError,
  deriveAccountLifecycle,
  isStaffRole,
  liveAssignments,
} from '../adapters'
import { canonicalUsername } from '../../../shared/username'
import {
  accountFixtures,
  assignmentFixtures,
  PENDING_ACCOUNT_ID,
  RESET_PENDING_ACCOUNT_ID,
} from './fixtures/accounts'

/**
 * The mock accounts adapter. Fixtures in, promises out, no I/O anywhere: the
 * demo tree is structurally incapable of reaching Supabase. It nevertheless
 * follows the account contract closely enough to walk truthful lifecycle and
 * assignment transitions rather than teaching an impossible shortcut.
 */

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
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

const DEMO_ACCOUNT_EMAILS = {
  superAdmin: 'owner.account@example.com',
  ordinaryAccount: null,
} as const satisfies DemoAccountEmailFixture

function lifecycleFor(account: Pick<AccountSummary, 'isActive' | 'hasSignedIn' | 'invite'>) {
  return deriveAccountLifecycle(account)
}

/** The demo's people list, shared by every surface that shows a person. */
export function createDemoAccounts(): AccountSummary[] {
  return accountFixtures.map((profile) => {
    const assignments = structuredClone(assignmentFixtures[profile.id] ?? [])
    const isOwner = liveAssignments(assignments).some(
      (assignment) => assignment.role === 'super_admin',
    )
    const hasSignedIn = profile.id !== PENDING_ACCOUNT_ID
    const invite =
      profile.id === PENDING_ACCOUNT_ID
        ? { purpose: 'activation' as const, expiresAt: inSevenDays() }
        : profile.id === RESET_PENDING_ACCOUNT_ID
          ? { purpose: 'password_reset' as const, expiresAt: inSevenDays() }
          : null
    const account: AccountSummary = {
      id: profile.id,
      fullName: profile.full_name,
      username: demoUsername(profile.full_name),
      accountEmail: isOwner ? DEMO_ACCOUNT_EMAILS.superAdmin : DEMO_ACCOUNT_EMAILS.ordinaryAccount,
      phone: profile.phone,
      isActive: profile.is_active,
      hasSignedIn,
      roleTitle: profile.role_title,
      assignments,
      invite,
      lifecycle: { kind: 'needs_setup' },
      stateFingerprint: `demo:${profile.id}:0`,
    }
    account.lifecycle = lifecycleFor(account)
    return account
  })
}

export function createMockAccountsAdapter(
  accounts: AccountSummary[],
  role: AppRole = 'super_admin',
  viewerId: string | null = null,
): AccountsAdapter {
  const versions = new Map(accounts.map((account) => [account.id, 0]))
  let nextId = 1
  let nextAssignmentId = 1

  function find(profileId: string): AccountSummary {
    const account = accounts.find((candidate) => candidate.id === profileId)
    if (!account) throw new Error(`No demo account: ${profileId}`)
    return account
  }

  function newAssignmentId(): string {
    return `da000000-0000-4000-b000-${String(nextAssignmentId++).padStart(12, '0')}`
  }

  function touch(account: AccountSummary): void {
    const version = (versions.get(account.id) ?? 0) + 1
    versions.set(account.id, version)
    account.lifecycle = lifecycleFor(account)
    account.stateFingerprint = `demo:${account.id}:${version}`
  }

  function requireFingerprint(account: AccountSummary, expected: string): void {
    if (account.stateFingerprint !== expected) {
      throw new AccountActionError('stale_edit', 'This person changed. Reload and try again.')
    }
  }

  function requireAvailableUsername(input: string, exceptId?: string): string {
    const wanted = canonicalUsername(input)
    if (!wanted) throw new AccountActionError('invalid_request', 'Enter a valid username.')
    if (accounts.some((account) => account.id !== exceptId && account.username === wanted)) {
      throw new AccountActionError('username_unavailable', 'That username is already in use.')
    }
    return wanted
  }

  function isLiveActivation(account: AccountSummary): boolean {
    return (
      account.invite?.purpose === 'activation' &&
      new Date(account.invite.expiresAt).getTime() > Date.now()
    )
  }

  function createHandover(account: AccountSummary, purpose: AccountInvitePurpose): AccountHandover {
    if (!account.isActive) {
      throw new AccountActionError(
        'account_inactive',
        'Reactivate this account before issuing a link.',
      )
    }
    if (!account.username)
      throw new AccountActionError('invalid_request', 'This account needs a username.')
    const expiresAt = inSevenDays()
    account.invite = { purpose, expiresAt }
    touch(account)
    return {
      profileId: account.id,
      username: account.username,
      code: demoCode(),
      expiresAt,
      purpose,
    }
  }

  function maybeReplaceActivation(account: AccountSummary): AccountHandover | null {
    return isLiveActivation(account) ? createHandover(account, 'activation') : null
  }

  function viewerManagedOutlets(): Set<string> {
    if (viewerId === null) return new Set()
    return new Set(
      liveAssignments(find(viewerId).assignments)
        .filter(
          (assignment) => assignment.role === 'franchise_admin' && assignment.outletId !== null,
        )
        .map((assignment) => assignment.outletId as string),
    )
  }

  function ensureMayManage(
    account: AccountSummary,
    intended: readonly Pick<Assignment, 'role' | 'outletId'>[],
  ): void {
    if (account.id === viewerId) {
      throw new AccountActionError('forbidden', 'You cannot change your own access here.')
    }
    if (role === 'super_admin') return
    if (role !== 'franchise_admin')
      throw new AccountActionError('forbidden', 'This action is not allowed.')

    const managed = viewerManagedOutlets()
    const complete = [...liveAssignments(account.assignments), ...intended]
    if (
      complete.some(
        (assignment) =>
          !isStaffRole(assignment.role) ||
          assignment.outletId === null ||
          !managed.has(assignment.outletId),
      )
    ) {
      throw new AccountActionError('forbidden', 'That person is outside your managed outlets.')
    }
  }

  function assertFinalOwnerIsRetained(
    account: AccountSummary,
    intended: readonly Pick<Assignment, 'role'>[],
  ): void {
    const before = liveAssignments(account.assignments).filter(
      (assignment) => assignment.role === 'super_admin',
    )
    const after = intended.filter((assignment) => assignment.role === 'super_admin')
    if (before.length === 0 || after.length > 0) return
    const anotherOwnerExists = accounts.some(
      (other) =>
        other.id !== account.id &&
        liveAssignments(other.assignments).some((assignment) => assignment.role === 'super_admin'),
    )
    if (!anotherOwnerExists) {
      throw new AccountActionError(
        'last_super_admin',
        'There has to be an owner. Appoint another one before removing this.',
      )
    }
  }

  function assertIntendedAssignments(command: EditAccountCommand, account: AccountSummary): void {
    if (command.assignments.length === 0) {
      throw new AccountActionError('invalid_request', 'Use Mark as left to remove every placement.')
    }
    const live = new Map(
      liveAssignments(account.assignments).map((assignment) => [assignment.id, assignment]),
    )
    const seenAssignmentIds = new Set<string>()
    const seenOutlets = new Set<string | null>()

    for (const assignment of command.assignments) {
      if (seenOutlets.has(assignment.outletId)) {
        throw new AccountActionError('invalid_request', 'Choose only one role at each outlet.')
      }
      seenOutlets.add(assignment.outletId)
      if (
        assignment.role === 'super_admin'
          ? assignment.outletId !== null
          : assignment.outletId === null
      ) {
        throw new AccountActionError('invalid_request', 'Choose a valid outlet for this role.')
      }
      if (assignment.assignmentId !== null) {
        if (seenAssignmentIds.has(assignment.assignmentId) || !live.has(assignment.assignmentId)) {
          throw new AccountActionError('invalid_request', 'That assignment is no longer available.')
        }
        seenAssignmentIds.add(assignment.assignmentId)
      }
    }
  }

  function replaceAssignments(account: AccountSummary, command: EditAccountCommand): Assignment[] {
    const live = new Map(
      liveAssignments(account.assignments).map((assignment) => [assignment.id, assignment]),
    )
    const retained = new Set<string>()
    const additions: Assignment[] = []

    for (const intended of command.assignments) {
      const previous = intended.assignmentId ? live.get(intended.assignmentId) : undefined
      if (
        previous &&
        previous.role === intended.role &&
        previous.outletId === intended.outletId &&
        previous.startedOn === intended.startedOn
      ) {
        retained.add(previous.id)
        continue
      }
      if (previous) previous.endedOn = today()
      additions.push({
        id: newAssignmentId(),
        role: intended.role,
        outletId: intended.outletId,
        startedOn: intended.startedOn,
        endedOn: null,
      })
    }
    for (const assignment of live.values()) {
      if (
        !retained.has(assignment.id) &&
        !command.assignments.some((next) => next.assignmentId === assignment.id)
      ) {
        assignment.endedOn = today()
      }
    }
    account.assignments.push(...additions)
    return account.assignments
  }

  function setAccountFacts(account: AccountSummary, command: EditAccountCommand): void {
    if (!command.fullName.trim())
      throw new AccountActionError('name_required', 'A person needs a name.')
    account.fullName = command.fullName.trim()
    account.phone = command.phone
    account.roleTitle = command.roleTitle

    const becomingOwner = command.assignments.some(
      (assignment) => assignment.role === 'super_admin',
    )
    const wantedEmail = command.accountEmail?.trim().toLowerCase() || null
    if (becomingOwner && !wantedEmail && !account.accountEmail) {
      throw new AccountActionError('invalid_request', 'A Super Admin assignment requires an email.')
    }
    if (
      wantedEmail &&
      accounts.some((other) => other.id !== account.id && other.accountEmail === wantedEmail)
    ) {
      throw new AccountActionError(
        'email_unavailable',
        'That email is already associated with another account.',
      )
    }
    // Demoting an owner retains their private email; ordinary edits never erase it.
    if (wantedEmail) account.accountEmail = wantedEmail
  }

  function assignmentResult(
    account: AccountSummary,
    replacementHandover: AccountHandover | null,
  ): AssignmentSetResult {
    return {
      profileId: account.id,
      assignments: structuredClone(account.assignments),
      stateFingerprint: account.stateFingerprint,
      replacementHandover,
    }
  }

  return {
    async listAccounts() {
      for (const account of accounts) account.lifecycle = lifecycleFor(account)
      return structuredClone(accounts)
    },

    async provision(input: NewAccount): Promise<IssuedCode> {
      const id = `d1000000-0000-4000-b000-${String(nextId++).padStart(12, '0')}`
      const username = requireAvailableUsername(input.username)
      const outletIds = input.role === 'super_admin' ? [null] : input.outletIds
      if (
        (input.role === 'super_admin' && input.outletIds.length > 0) ||
        (input.role !== 'super_admin' &&
          (outletIds.length === 0 || new Set(outletIds).size !== outletIds.length)) ||
        (input.role === 'super_admin' && !input.accountEmail?.trim()) ||
        (input.role !== 'super_admin' && input.accountEmail != null)
      ) {
        throw new AccountActionError('invalid_request', 'Choose at least one valid outlet.')
      }
      const account: AccountSummary = {
        id,
        fullName: input.fullName,
        username,
        accountEmail:
          input.role === 'super_admin' ? input.accountEmail!.trim().toLowerCase() : null,
        phone: input.phone ?? null,
        isActive: true,
        hasSignedIn: false,
        roleTitle: input.roleTitle ?? null,
        assignments: outletIds.map((outletId) => ({
          id: newAssignmentId(),
          role: input.role,
          outletId,
          startedOn: input.joinedOn ?? today(),
          endedOn: null,
        })),
        invite: null,
        lifecycle: { kind: 'needs_setup' },
        stateFingerprint: `demo:${id}:0`,
      }
      accounts.push(account)
      versions.set(id, 0)
      return createHandover(account, 'activation')
    },

    async issueHandover(profileId: string): Promise<AccountHandover> {
      const account = find(profileId)
      ensureMayManage(account, liveAssignments(account.assignments))
      return createHandover(account, account.hasSignedIn ? 'password_reset' : 'activation')
    },

    async editAccount(command: EditAccountCommand): Promise<AssignmentSetResult> {
      const account = find(command.profileId)
      requireFingerprint(account, command.expectedStateFingerprint)
      assertIntendedAssignments(command, account)
      ensureMayManage(account, command.assignments)
      assertFinalOwnerIsRetained(account, command.assignments)
      setAccountFacts(account, command)
      replaceAssignments(account, command)
      touch(account)
      const replacementHandover = maybeReplaceActivation(account)
      return assignmentResult(account, replacementHandover)
    },

    async markAsLeft(
      profileId: string,
      expectedStateFingerprint: string,
    ): Promise<AssignmentSetResult> {
      const account = find(profileId)
      requireFingerprint(account, expectedStateFingerprint)
      ensureMayManage(account, [])
      assertFinalOwnerIsRetained(account, [])
      for (const assignment of liveAssignments(account.assignments)) assignment.endedOn = today()
      account.isActive = false
      touch(account)
      return assignmentResult(account, null)
    },

    // Legacy actions remain during call-site cutover. They preserve the new
    // lifecycle semantics, but new UI uses the methods above.
    async reissue(profileId: string): Promise<IssuedCode> {
      return await this.issueHandover(profileId)
    },

    async setActive(profileId: string, isActive: boolean) {
      const account = find(profileId)
      account.isActive = isActive
      touch(account)
    },

    async grantAssignment(input) {
      const account = find(input.personId)
      ensureMayManage(account, [
        ...liveAssignments(account.assignments),
        { id: '', role: input.role, outletId: input.outletId, startedOn: today(), endedOn: null },
      ])
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
      if (input.role === 'super_admin')
        account.accountEmail = input.accountEmail!.trim().toLowerCase()
      touch(account)
      return maybeReplaceActivation(account)
    },

    async endAssignment(assignmentId: string) {
      for (const account of accounts) {
        const assignment = account.assignments.find((candidate) => candidate.id === assignmentId)
        if (!assignment || assignment.endedOn !== null) continue
        const intended = liveAssignments(account.assignments).filter(
          (candidate) => candidate.id !== assignmentId,
        )
        ensureMayManage(account, intended)
        assertFinalOwnerIsRetained(account, intended)
        assignment.endedOn = today()
        touch(account)
        return maybeReplaceActivation(account)
      }
      throw new AccountActionError('not_found', 'That assignment no longer exists.')
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
      touch(account)
    },

    async setAccountEmail(profileId: string, accountEmail: string) {
      if (profileId === viewerId) {
        throw new AccountActionError(
          'self_change_forbidden',
          'You cannot change your own email here.',
        )
      }
      const account = find(profileId)
      if (
        !liveAssignments(account.assignments).some(
          (assignment) => assignment.role === 'super_admin',
        )
      ) {
        throw new AccountActionError('forbidden', 'Only a Super Admin email can be changed here.')
      }
      const wanted = accountEmail.trim().toLowerCase()
      if (
        !wanted ||
        accounts.some((other) => other.id !== profileId && other.accountEmail === wanted)
      ) {
        throw new AccountActionError(
          'email_unavailable',
          'That email is already associated with another account.',
        )
      }
      account.accountEmail = wanted
      touch(account)
    },

    async updateStaffFacts(profileId: string, patch: StaffFactsPatch) {
      const account = find(profileId)
      if (patch.fullName !== undefined && patch.fullName.trim() === '') {
        throw new AccountActionError('name_required', 'A person needs a name.')
      }
      Object.assign(account, {
        ...(patch.fullName !== undefined && { fullName: patch.fullName }),
        ...(patch.roleTitle !== undefined && { roleTitle: patch.roleTitle }),
      })
      touch(account)
      return structuredClone(account)
    },

    async failedActivations() {
      return 2
    },
  }
}
