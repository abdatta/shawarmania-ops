import type {
  AccountsAdapter,
  AccountSummary,
  AppRole,
  IssuedCode,
  NewAccount,
  StaffFactsPatch,
} from '../adapters'
import { AccountActionError, isOutletPerson } from '../adapters'
import { accountFixtures, DEMO_HELPER_ACCOUNT_ID, PENDING_ACCOUNT_ID } from './fixtures/accounts'
import { outletFixtures } from './fixtures/outlets'

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
    role: profile.role,
    outletId: profile.outlet_id,
    isActive: profile.is_active,
    staffCode: profile.staff_code,
    roleTitle: profile.role_title,
    joinedOn: profile.joined_on,
    leftOn: profile.left_on,
    invite: profile.id === PENDING_ACCOUNT_ID ? { expiresAt: inSevenDays() } : null,
  }))
}

export function createMockAccountsAdapter(
  accounts: AccountSummary[],
  /**
   * Who is looking. The staff-code rule is owner-only and the demo must
   * refuse a manager the same way `staff_code_guard` does — a demo that let
   * one through would teach a product this one is not. Defaults to the owner,
   * which is the unrestricted case and what a test wants unless it says
   * otherwise.
   */
  role: AppRole = 'super_admin',
): AccountsAdapter {
  const find = (profileId: string): AccountSummary => {
    const account = accounts.find((candidate) => candidate.id === profileId)
    if (!account) throw new Error(`No demo account: ${profileId}`)
    return account
  }

  let nextId = 1

  /**
   * Deterministic, like the roster mock's generator before it: same codes
   * every run, right shape, no flaking snapshots. The stride is a prime so
   * consecutive codes do not read as a serial.
   */
  let suffixSeed = 0
  function nextSuffix(): string {
    suffixSeed += 1
    let n = (suffixSeed * 7919) % 32 ** 4
    let out = ''
    for (let i = 0; i < 4; i += 1) {
      out = ALPHABET[n % 32] + out
      n = Math.floor(n / 32)
    }
    return out
  }

  /** `KAL-7KQ2` — the outlet's own prefix, never a hardcoded one. */
  function issueCode(outletId: string): string {
    const prefix = outletFixtures.find((outlet) => outlet.id === outletId)?.staff_code_prefix
    if (!prefix) throw new Error(`No demo outlet: ${outletId}`)
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const candidate = `${prefix}-${nextSuffix()}`
      if (!accounts.some((row) => row.outletId === outletId && row.staffCode === candidate)) {
        return candidate
      }
    }
    throw new Error(`Could not issue a staff code for outlet ${outletId}`)
  }

  function refuseTakenCode(outletId: string | null, code: string, exceptId?: string) {
    if (
      accounts.some(
        (other) => other.id !== exceptId && other.outletId === outletId && other.staffCode === code,
      )
    ) {
      throw new AccountActionError('code_taken', 'That staff code is already used at this outlet.')
    }
  }

  return {
    async listAccounts() {
      return structuredClone(accounts)
    },

    async provision(account: NewAccount): Promise<IssuedCode> {
      const id = `d1000000-0000-4000-b000-${String(nextId++).padStart(12, '0')}`
      const expiresAt = inSevenDays()
      refuseTakenEmail(account.email)
      const person = isOutletPerson({ role: account.role, outletId: account.outletId })
      accounts.push({
        id,
        fullName: account.fullName,
        email: account.email.trim().toLowerCase(),
        phone: account.phone ?? null,
        role: account.role,
        outletId: account.outletId,
        isActive: true,
        // One step creates a working person: the staff facts land with the
        // account, and the code is issued exactly as the insert trigger would.
        staffCode: person && account.outletId ? issueCode(account.outletId) : null,
        roleTitle: person ? (account.roleTitle ?? null) : null,
        joinedOn: person ? (account.joinedOn ?? null) : null,
        leftOn: null,
        invite: { expiresAt },
      })
      return { profileId: id, code: demoCode(), expiresAt }
    },

    async reissue(profileId: string): Promise<IssuedCode> {
      const account = find(profileId)
      const expiresAt = inSevenDays()
      account.invite = { expiresAt }
      return { profileId, code: demoCode(), expiresAt }
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
     * The staff-fact edit, refusing what the database refuses: a non-owner
     * changing a code, the blanking of an issued one, a duplicate at the
     * outlet, a departure before the joining date.
     */
    async updateStaffFacts(profileId: string, patch: StaffFactsPatch) {
      const account = find(profileId)

      if (patch.staffCode !== undefined && patch.staffCode !== account.staffCode) {
        if (role !== 'super_admin') {
          throw new AccountActionError('code_not_yours', 'Only the owner can change a staff code.')
        }
        const next = patch.staffCode.trim()
        if (!next) {
          throw new AccountActionError(
            'code_required',
            'A staff code is needed — it is how this person’s records are identified.',
          )
        }
        refuseTakenCode(account.outletId, next, profileId)
      }

      const joinedOn = patch.joinedOn !== undefined ? patch.joinedOn : account.joinedOn
      const leftOn = patch.leftOn !== undefined ? patch.leftOn : account.leftOn
      if (joinedOn && leftOn && leftOn < joinedOn) {
        throw new AccountActionError(
          'left_before_joining',
          'A departure date cannot be before the joining date.',
        )
      }

      Object.assign(account, {
        ...(patch.fullName !== undefined && { fullName: patch.fullName }),
        ...(patch.roleTitle !== undefined && { roleTitle: patch.roleTitle }),
        ...(patch.joinedOn !== undefined && { joinedOn: patch.joinedOn }),
        ...(patch.leftOn !== undefined && { leftOn: patch.leftOn }),
        ...(patch.staffCode !== undefined && { staffCode: patch.staffCode.trim() }),
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
}
