import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'

/**
 * Who is calling, and what they are allowed to do about it.
 *
 * The house rule (docs/ROLES_AND_PERMISSIONS.md): **being an Edge Function is
 * not authorisation.** Running with the service-role key means RLS is not
 * watching, so every capability below is re-derived from the caller's own
 * verified token and their own profile row — never from anything in the
 * request body, which the caller controls.
 */

export type AppRole = 'super_admin' | 'franchise_admin' | 'biller' | 'employee'

export const APP_ROLES: readonly AppRole[] = [
  'super_admin',
  'franchise_admin',
  'biller',
  'employee',
]

/**
 * One place a person may work, as one role. Since multi-outlet-people a person
 * holds a SET of these rather than a single role-and-outlet pair, so every
 * capability below is a question about the set.
 */
export interface Assignment {
  role: AppRole
  outletId: string | null
}

export interface Caller {
  id: string
  assignments: Assignment[]
}

export interface TargetAccount {
  id: string
  assignments: Assignment[]
  isActive: boolean
}

/** Does this person hold the business-wide owner role? */
export function isOwner(who: { assignments: Assignment[] }): boolean {
  return who.assignments.some((a) => a.role === 'super_admin')
}

/** The outlets this person holds a live assignment at, in the given role. */
export function outletsFor(who: { assignments: Assignment[] }, role: AppRole): string[] {
  return who.assignments
    .filter((a) => a.role === role && a.outletId !== null)
    .map((a) => a.outletId as string)
}

/** The privileged client. Its key is injected by the runtime and never leaves it. */
export function serviceClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be present in the runtime')
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

/**
 * The caller, or null. Null covers every way of not being a usable admin
 * session: no header, the anon key rather than a user token, an expired token,
 * a user with no profile, or a deactivated one.
 */
export async function callerFrom(req: Request, service: SupabaseClient): Promise<Caller | null> {
  const header = req.headers.get('Authorization') ?? ''
  if (!header.toLowerCase().startsWith('bearer ')) return null
  const token = header.slice(7).trim()
  if (token === '') return null

  const { data, error } = await service.auth.getUser(token)
  if (error || !data.user) return null

  const profile = await loadAccount(service, data.user.id)
  if (!profile || !profile.isActive) return null

  return { id: profile.id, assignments: profile.assignments }
}

export async function loadAccount(
  service: SupabaseClient,
  profileId: string,
): Promise<TargetAccount | null> {
  const { data, error } = await service
    .from('profiles')
    .select('id, is_active, assignments(role, outlet_id, ended_on)')
    .eq('id', profileId)
    .maybeSingle()
  if (error || !data) return null

  // Live rows only. An ended assignment is history, and history confers
  // nothing — the same rule the database's own helpers apply.
  const rows = (data.assignments ?? []) as {
    role: AppRole
    outlet_id: string | null
    ended_on: string | null
  }[]
  return {
    id: data.id as string,
    assignments: rows
      .filter((a) => a.ended_on === null)
      .map((a) => ({ role: a.role, outletId: a.outlet_id })),
    isActive: data.is_active as boolean,
  }
}

/**
 * May this caller create an account with this role at these outlets?
 *
 * Super Admin: anyone, anywhere. Franchise Admin: Billers and Employees, in
 * their managed outlets, and nothing else — they cannot mint a peer, they cannot
 * mint an owner, and they cannot reach across the boundary. Billers and
 * Employees have no provisioning capability at all.
 */
export function mayProvision(
  caller: Caller,
  targetRole: AppRole,
  targetOutletIds: readonly string[],
): boolean {
  // An owner is outlet-less; every scoped role needs a non-empty SET, not an
  // array with duplicate assignment attempts waiting to fail after account
  // creation.
  const outletShapeValid =
    targetRole === 'super_admin'
      ? targetOutletIds.length === 0
      : targetOutletIds.length > 0 && new Set(targetOutletIds).size === targetOutletIds.length
  if (!outletShapeValid) return false

  if (isOwner(caller)) return true
  if (targetRole !== 'biller' && targetRole !== 'employee') return false
  const managed = new Set(outletsFor(caller, 'franchise_admin'))
  return targetOutletIds.every((outletId) => managed.has(outletId))
}

/**
 * May this caller grant, or end, this assignment?
 *
 * The database enforces the same rule (`assignments_insert` plus its guard);
 * this is the edge restating it so a refusal is a 403 with a name rather than
 * a policy violation surfacing as a 500.
 *
 * **The self-assignment carve-out lives here too** (multi-outlet-people design
 * D7): a Super Admin may place themselves at an outlet, because production
 * holds exactly one and requiring a second person would make the owner
 * day-running a shop impossible; nobody may ever grant themselves the owner
 * role, which is the only self-grant that widens what they can do.
 */
export function mayAssign(
  caller: Caller,
  targetPersonId: string,
  role: AppRole,
  outletId: string | null,
): boolean {
  const outletShapeValid = role === 'super_admin' ? outletId === null : outletId !== null
  if (!outletShapeValid) return false

  if (targetPersonId === caller.id) {
    if (role === 'super_admin') return false
    if (!isOwner(caller)) return false
    return true
  }

  if (isOwner(caller)) return true
  if (role !== 'biller' && role !== 'employee') return false
  return outletId !== null && outletsFor(caller, 'franchise_admin').includes(outletId)
}

/**
 * May this caller re-issue a code for, or change the active flag of, this
 * existing account?
 *
 * Nobody may manage themselves. Deactivating your own account is an easy
 * accident with no in-app recovery — there is no self-service reset to climb
 * back through — and re-issuing your own code is meaningless when you are
 * already signed in.
 */
export function mayManage(caller: Caller, target: TargetAccount): boolean {
  if (caller.id === target.id) return false
  if (isOwner(caller)) return true

  const managed = outletsFor(caller, 'franchise_admin')
  if (managed.length === 0) return false

  // An account is not this manager's to act on unless EVERY place the person
  // works is a place this manager runs. Deactivating somebody who also works
  // at the other outlet would reach across the boundary through the person —
  // the account is one object, and switching it off switches it off
  // everywhere. Somebody with no assignment at all is nobody's to manage but
  // the owner's, which the empty-set case gives for free.
  if (target.assignments.length === 0) return false
  return target.assignments.every(
    (a) => a.role !== 'super_admin' && a.outletId !== null && managed.includes(a.outletId),
  )
}

/**
 * Does this caller manage anybody at all?
 *
 * Used to refuse an account-management request outright rather than answering
 * it with an empty result. The difference matters for reading sign-in identifiers
 * (design D12): a Biller is a *shared counter tablet*, and "you get nothing
 * because nothing matched" is a boundary that merely happens to hold today.
 * "You may not ask" is one that stays held when the matching changes.
 */
export function managesAnyone(caller: Caller): boolean {
  return isOwner(caller) || outletsFor(caller, 'franchise_admin').length > 0
}
