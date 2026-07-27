import type { AccountsAdapter, AccountSummary, IssuedCode, NewAccount } from '../adapters'
import { AccountActionError } from '../adapters'
import { accountFixtures, PENDING_ACCOUNT_ID } from './fixtures/accounts'

/**
 * The mock accounts adapter. Fixtures in, promises out, no I/O anywhere — the
 * demo tree is structurally incapable of reaching Supabase (design D4).
 *
 * Unlike the outlets mock this one holds state, because the surface it serves
 * is about *doing* things: provisioning in a demo has to show a row appearing
 * and a code coming back, or the demo is a screenshot. The state dies with the
 * demo tree and never outlives a walkthrough.
 *
 * The list is created separately and handed in, because the roster mock reads
 * it too: an account deactivated on Access has to read as deactivated on Staff
 * in the same walkthrough, and two private copies would quietly disagree.
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

/** The demo's account list, shared by the accounts and roster mocks. */
export function createDemoAccounts(): AccountSummary[] {
  return accountFixtures.map((profile) => ({
    id: profile.id,
    fullName: profile.full_name,
    email: demoEmail(profile.full_name),
    phone: profile.phone,
    role: profile.role,
    outletId: profile.outlet_id,
    isActive: profile.is_active,
    invite: profile.id === PENDING_ACCOUNT_ID ? { expiresAt: inSevenDays(), attempts: 0 } : null,
  }))
}

export function createMockAccountsAdapter(accounts: AccountSummary[]): AccountsAdapter {
  const find = (profileId: string): AccountSummary => {
    const account = accounts.find((candidate) => candidate.id === profileId)
    if (!account) throw new Error(`No demo account: ${profileId}`)
    return account
  }

  let nextId = 1

  return {
    async listAccounts() {
      return structuredClone(accounts)
    },

    async provision(account: NewAccount): Promise<IssuedCode> {
      // `d1…` is the profile range. The `d2…a…` range this used to mint is the
      // roster's, and the very first id it produced was already a roster row's
      // — harmless while the two lists were never compared, actively
      // misleading now that the link compares them (design D11).
      const id = `d1000000-0000-4000-b000-${String(nextId++).padStart(12, '0')}`
      const expiresAt = inSevenDays()
      refuseTakenEmail(account.email)
      accounts.push({
        id,
        fullName: account.fullName,
        email: account.email.trim().toLowerCase(),
        phone: account.phone ?? null,
        role: account.role,
        outletId: account.outletId,
        isActive: true,
        invite: { expiresAt, attempts: 0 },
      })
      return { profileId: id, code: demoCode(), expiresAt }
    },

    async reissue(profileId: string): Promise<IssuedCode> {
      const account = find(profileId)
      const expiresAt = inSevenDays()
      account.invite = { expiresAt, attempts: 0 }
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
