import type { Assignment } from '@/data-access/adapters'
import {
  assignedOutlets,
  highestRole,
  liveAssignments,
  outletsForRole,
} from '@/data-access/adapters'
import type { Database, Tables } from '@/data-access/database.types'

/**
 * The session contract both modes implement — a real Supabase session (#4)
 * or a demo session driven by the URL. Shell components and features read
 * `assignments`, `displayName` and the two derived conveniences identically
 * from either variant; the only mode-specific member is the demo persona, and
 * only demo chrome (the role switcher) may reach for it.
 */

/** Tied to the database enum so a role the schema does not know is a compile error. */
export type Role = Database['public']['Enums']['app_role']

/** An invented person for demo mode, typed from the schema like every fixture. */
export interface DemoPersona {
  profile: Tables<'profiles'>
  outlet: Tables<'outlets'> | null
  assignments: Assignment[]
}

/**
 * `userId` is present in both variants on purpose. "Which of these rows is
 * me?" is a question surfaces ask in either mode — the People list marks your
 * own row and offers you no destructive action on it — and a field that
 * existed in only one mode would force exactly the mode-conditional branch the
 * shell contract forbids. In demo it is the persona's id; nothing authenticates
 * against it either way.
 *
 * `assignments` is the authority since multi-outlet-people. `role` and
 * `outletId` survive as **derived conveniences**, and only mean what they used
 * to for the overwhelmingly common single-assignment person: `role` is the
 * highest role held, `outletId` the one outlet when there is exactly one and
 * null otherwise. A surface that must handle several reads `assignments`; one
 * that genuinely concerns a single outlet keeps working unchanged.
 */
interface SessionCore {
  userId: string
  assignments: Assignment[]
  role: Role | null
  outletId: string | null
  displayName: string
}

export type Session =
  ({ mode: 'real' } & SessionCore) | ({ mode: 'demo'; persona: DemoPersona } & SessionCore)

/**
 * Build the derived half of a session from its assignments, so real and demo
 * providers cannot drift on what "your role" means.
 */
export function deriveSessionScope(assignments: Assignment[]): {
  role: Role | null
  outletId: string | null
} {
  const outlets = assignedOutlets(assignments)
  return {
    role: highestRole(assignments),
    outletId: outlets.length === 1 ? (outlets[0] ?? null) : null,
  }
}

/** Does this session hold a live assignment in the given role, anywhere? */
export function holdsRole(session: Session, role: Role): boolean {
  return liveAssignments(session.assignments).some((a) => a.role === role)
}

/**
 * Every role this session holds live, most senior first.
 *
 * This is the honest answer to "which roles does this person hold", and it is
 * what any surface *stating* somebody's roles must use — the account menu does.
 * For deciding which shells and navigation entries exist, see
 * `reachableRoles`, which is a different question.
 */
export function heldRoles(session: Session): Role[] {
  const held = new Set(liveAssignments(session.assignments).map((a) => a.role))
  return ROLE_ORDER.filter((role) => held.has(role))
}

/**
 * Every role whose surfaces this session may **reach**, most senior first.
 *
 * Held roles, plus one addition: **a session holding the owner role reaches the
 * outlet-level surfaces, at every outlet, holding no assignment at any of them**
 * (owner-reaches-every-outlet, design D1). Running every outlet is what that
 * role is, and the database has always answered it that way — every
 * outlet-scoped policy carries an owner branch, and the attendance guard reads
 * "an admin here" as *the owner, or a manager at this outlet*. Before this,
 * navigation and routing asked `heldRoles`, so the owner had to grant themselves
 * a manager assignment at each outlet to see its attendance, which is authority
 * they already had.
 *
 * Three things this deliberately is not:
 *
 *   * **Not a role hierarchy.** The owner reaches one further set of surfaces;
 *     no role inherits another's authority, and a manager assignment at Kalyani
 *     still confers nothing at Kanchrapara (owner, 2026-07-28).
 *   * **Not a claim about assignments.** `heldRoles` stays the answer to what
 *     somebody holds, so an owner who manages no outlet is never told they do.
 *   * **Not authority.** Reaching a surface confers nothing: the database
 *     decides every write from the assignment, which is why the owner reaches
 *     an outlet's cash surface and is still refused its drawer (design D2).
 */
export function reachableRoles(session: Session): Role[] {
  const reachable = new Set(heldRoles(session))
  if (reachable.has('super_admin')) reachable.add('franchise_admin')
  return ROLE_ORDER.filter((role) => reachable.has(role))
}

/** The outlets this session may act at in the given role. */
export function sessionOutletsFor(session: Session, role: Role): string[] {
  return outletsForRole(session.assignments, role)
}

/** Every outlet this session works at, in any role. */
export function sessionOutlets(session: Session): string[] {
  return assignedOutlets(session.assignments)
}

/** Most senior first. Orders shells and navigation; confers nothing. */
const ROLE_ORDER: Role[] = ['super_admin', 'franchise_admin', 'biller', 'employee']

export type SessionMode = Session['mode']

/**
 * Role path segments — `owner`, `admin`, `biller`, `staff` — are the stable,
 * shareable spelling of the four roles. They match how the business talks
 * about the people, not the internal enum, and they are used consistently by
 * routing, the gate registry, and shared links in both real and demo trees.
 *
 * The biller's segment names the *person*, not the station: `counter` is
 * already the physical counter and the enrolled counter device (see the
 * glossary), so a third meaning in the URL read as a place rather than a role.
 */
export const ROLE_SEGMENTS = {
  super_admin: 'owner',
  franchise_admin: 'admin',
  biller: 'biller',
  employee: 'staff',
} as const satisfies Record<Role, string>

export type RoleSegment = (typeof ROLE_SEGMENTS)[Role]

export const ROLE_LABELS = {
  super_admin: 'Owner',
  franchise_admin: 'Admin',
  biller: 'Biller',
  employee: 'Staff',
} as const satisfies Record<Role, string>

const SEGMENT_ROLES: Record<string, Role> = Object.fromEntries(
  (Object.entries(ROLE_SEGMENTS) as [Role, RoleSegment][]).map(([role, segment]) => [
    segment,
    role,
  ]),
)

/** The role a path segment names, or undefined for a segment that names none. */
export function roleFromSegment(segment: string | undefined): Role | undefined {
  return segment ? SEGMENT_ROLES[segment] : undefined
}
