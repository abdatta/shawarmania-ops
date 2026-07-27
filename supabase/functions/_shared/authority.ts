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

export interface Caller {
  id: string
  role: AppRole
  outletId: string | null
}

export interface TargetAccount {
  id: string
  role: AppRole
  outletId: string | null
  isActive: boolean
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

  return { id: profile.id, role: profile.role, outletId: profile.outletId }
}

export async function loadAccount(
  service: SupabaseClient,
  profileId: string,
): Promise<TargetAccount | null> {
  const { data, error } = await service
    .from('profiles')
    .select('id, role, outlet_id, is_active')
    .eq('id', profileId)
    .maybeSingle()
  if (error || !data) return null
  return {
    id: data.id as string,
    role: data.role as AppRole,
    outletId: (data.outlet_id as string | null) ?? null,
    isActive: data.is_active as boolean,
  }
}

/**
 * May this caller create an account with this role in this outlet?
 *
 * Super Admin: anyone, anywhere. Franchise Admin: Billers and Employees, in
 * their own outlet, and nothing else — they cannot mint a peer, they cannot
 * mint an owner, and they cannot reach across the boundary. Billers and
 * Employees have no provisioning capability at all.
 */
export function mayProvision(
  caller: Caller,
  targetRole: AppRole,
  targetOutletId: string | null,
): boolean {
  // The schema constraint restated at the edge, so a bad request is a 400 here
  // rather than a constraint violation three statements later.
  const outletShapeValid =
    targetRole === 'super_admin' ? targetOutletId === null : targetOutletId !== null
  if (!outletShapeValid) return false

  if (caller.role === 'super_admin') return true
  if (caller.role === 'franchise_admin') {
    return (
      (targetRole === 'biller' || targetRole === 'employee') &&
      caller.outletId !== null &&
      targetOutletId === caller.outletId
    )
  }
  return false
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
  if (caller.role === 'super_admin') return true
  if (caller.role === 'franchise_admin') {
    return (
      (target.role === 'biller' || target.role === 'employee') &&
      caller.outletId !== null &&
      target.outletId === caller.outletId
    )
  }
  return false
}

/**
 * Does this caller manage anybody at all?
 *
 * Used to refuse an account-management request outright rather than answering
 * it with an empty result. The difference matters for reading email addresses
 * (design D12): a Biller is a *shared counter tablet*, and "you get nothing
 * because nothing matched" is a boundary that merely happens to hold today.
 * "You may not ask" is one that stays held when the matching changes.
 */
export function managesAnyone(caller: Caller): boolean {
  return caller.role === 'super_admin' || caller.role === 'franchise_admin'
}
