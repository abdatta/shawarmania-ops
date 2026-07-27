import type { Database, Tables } from '@/data-access/database.types'

/**
 * The session contract both modes implement — a real Supabase session (#4)
 * or a demo session driven by the URL. Shell components and features read
 * `role`, `outletId` and `displayName` identically from either variant; the
 * only mode-specific member is the demo persona, and only demo chrome (the
 * role switcher) may reach for it.
 */

/** Tied to the database enum so a role the schema does not know is a compile error. */
export type Role = Database['public']['Enums']['app_role']

/** An invented person for demo mode, typed from the schema like every fixture. */
export interface DemoPersona {
  profile: Tables<'profiles'>
  outlet: Tables<'outlets'> | null
}

export type Session =
  | { mode: 'real'; userId: string; role: Role; outletId: string | null; displayName: string }
  | {
      mode: 'demo'
      role: Role
      outletId: string | null
      displayName: string
      persona: DemoPersona
    }

export type SessionMode = Session['mode']

/**
 * Role path segments — `owner`, `admin`, `counter`, `staff` — are the stable,
 * shareable spelling of the four roles. They match how the business talks
 * about the people, not the internal enum, and they are used consistently by
 * routing, the gate registry, and shared links in both real and demo trees.
 */
export const ROLE_SEGMENTS = {
  super_admin: 'owner',
  franchise_admin: 'admin',
  biller: 'counter',
  employee: 'staff',
} as const satisfies Record<Role, string>

export type RoleSegment = (typeof ROLE_SEGMENTS)[Role]

export const ROLE_LABELS = {
  super_admin: 'Owner',
  franchise_admin: 'Admin',
  biller: 'Counter',
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
