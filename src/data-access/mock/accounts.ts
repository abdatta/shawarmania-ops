import type { AccountsAdapter, AccountSummary, IssuedCode, NewAccount } from '../adapters'
import { accountFixtures, PENDING_ACCOUNT_ID } from './fixtures/accounts'

/**
 * The mock accounts adapter. Fixtures in, promises out, no I/O anywhere — the
 * demo tree is structurally incapable of reaching Supabase (design D4).
 *
 * Unlike the outlets mock this one holds state, because the surface it serves
 * is about *doing* things: provisioning in a demo has to show a row appearing
 * and a code coming back, or the demo is a screenshot. The state lives in the
 * closure, so it dies with the demo tree and never outlives a walkthrough.
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

export function createMockAccountsAdapter(): AccountsAdapter {
  const accounts: AccountSummary[] = accountFixtures.map((profile) => ({
    id: profile.id,
    fullName: profile.full_name,
    phone: profile.phone,
    role: profile.role,
    outletId: profile.outlet_id,
    isActive: profile.is_active,
    invite: profile.id === PENDING_ACCOUNT_ID ? { expiresAt: inSevenDays(), attempts: 0 } : null,
  }))

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
      const id = `d2000000-0000-4000-a000-${String(nextId++).padStart(12, '0')}`
      const expiresAt = inSevenDays()
      accounts.push({
        id,
        fullName: account.fullName,
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
  }
}
