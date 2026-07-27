import type { Tables } from './database.types'

/**
 * The adapter seam — one typed interface per domain area, two implementations
 * each: a Supabase adapter (real data) and a mock adapter (fixtures typed
 * from the generated schema types). Screens depend on these interfaces and
 * on nothing below them; swapping an implementation must never touch a
 * screen. See docs/DEMO_MODE.md and design D2 of demo-mode-and-app-shell.
 *
 * Interfaces are added here by the `ui-*` change that needs them, shaped by
 * real screen requirements — not designed speculatively. `outlets` is the
 * exemplar the shells themselves consume.
 */

export interface OutletsAdapter {
  /** Active outlets, for the surfaces a role can see. */
  listOutlets(): Promise<Tables<'outlets'>[]>
  /** One outlet by id, or null if it does not exist. */
  getOutlet(id: string): Promise<Tables<'outlets'> | null>
}

export type AppRole = Tables<'profiles'>['role']

/** One row of the People / Access surfaces: the account and its invite state. */
export interface AccountSummary {
  id: string
  fullName: string
  phone: string | null
  role: AppRole
  outletId: string | null
  isActive: boolean
  /**
   * The outstanding invite, if there is one. Never carries the code — the
   * hash column is not readable by any client (see the account_invites
   * migration), and the code itself exists only in the response that issued
   * it. "Pending since Tuesday" is all a list can honestly show.
   */
  invite: { expiresAt: string; attempts: number } | null
}

export interface NewAccount {
  fullName: string
  email: string
  phone?: string | null
  role: AppRole
  outletId: string | null
}

/** The one-time code, returned once and never retrievable again. */
export interface IssuedCode {
  profileId: string
  code: string
  expiresAt: string
}

/**
 * A refusal the UI can say something useful about. The `code` is the
 * machine-readable one the privileged function returned; anything unrecognised
 * surfaces as a generic failure rather than as a leaked internal string.
 */
export class AccountActionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'AccountActionError'
  }
}

/**
 * Account management as the admin surfaces need it. Every write here is a
 * privileged operation that runs server-side with the service-role key — the
 * adapter is the seam in front of it, not the thing doing it.
 */
export interface AccountsAdapter {
  /** Accounts the caller may see: all outlets for the Super Admin, one for a Franchise Admin. */
  listAccounts(): Promise<AccountSummary[]>
  provision(account: NewAccount): Promise<IssuedCode>
  reissue(profileId: string): Promise<IssuedCode>
  setActive(profileId: string, isActive: boolean): Promise<void>
}

/** The bag of domain adapters a session provider supplies to its tree. */
export interface DataAdapters {
  outlets: OutletsAdapter
  accounts: AccountsAdapter
}
