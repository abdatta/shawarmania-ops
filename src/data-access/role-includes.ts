import type { Database } from './database.types'

type AppRole = Database['public']['Enums']['app_role']

/**
 * Which staff role includes which (staff-roles-include-other-roles, design D1,
 * D7): the app's copy of `public.staff_roles` and `public.staff_role_includes`.
 * Each entry says what a role can do beyond itself, as the roles it **directly
 * includes**: a Biller includes an Employee. Includes are followed down any
 * number of entries, so a role can do everything every role below it can.
 *
 * A role may include several roles, and several roles may include the same
 * one, so the roles form a tree that can branch: a Cook and a Biller could both
 * include a Waiter without either including the other. There are no ranks and
 * no numbers; only these statements.
 *
 * **This is the one place the app names a staff role as staff.** Every other
 * question — is this person staff, which roles may a manager grant, which shells
 * does a Biller also reach — is answered from here, and `npm run lint` refuses a
 * file that lists staff roles itself. `role-includes.test.ts` holds this map to
 * the database's rows.
 *
 * Managers and the owner are not staff roles. Their authority is their own and
 * never answered from here.
 *
 * Listed most senior first: the order roles are offered and shown in. A role
 * comes before every role it includes, and a test holds it to that.
 */
export const STAFF_ROLE_INCLUDES = {
  biller: ['employee'],
  employee: [],
} as const satisfies Partial<Record<AppRole, readonly AppRole[]>>

export type StaffRole = keyof typeof STAFF_ROLE_INCLUDES

type Includes = Readonly<Partial<Record<string, readonly string[]>>>

/** The staff roles, most senior first. */
export const STAFF_ROLES_BY_SENIORITY = Object.keys(STAFF_ROLE_INCLUDES) as StaffRole[]

/** The role a new person is given unless somebody chooses otherwise: one that includes nothing. */
export const FIRST_STAFF_ROLE: StaffRole = STAFF_ROLES_BY_SENIORITY.find(
  (role) => STAFF_ROLE_INCLUDES[role].length === 0,
)!

/**
 * Is this role a staff role? False for a manager, the owner, and **a role this
 * build does not know**, which is ignored rather than an error, so a role added
 * after this build cannot break the shell of a phone that has not reloaded
 * (design D6).
 */
export function isStaffRoleIn(map: Includes, role: string): boolean {
  return Object.prototype.hasOwnProperty.call(map, role)
}

/** Every role a role includes, itself first, then down every entry. */
export function rolesIncludedByIn(map: Includes, role: string): string[] {
  if (!isStaffRoleIn(map, role)) return []
  const seen = new Set<string>([role])
  const queue = [role]
  while (queue.length > 0) {
    for (const below of map[queue.shift()!] ?? []) {
      if (!seen.has(below)) {
        seen.add(below)
        queue.push(below)
      }
    }
  }
  return [...seen]
}

/** Does a held role include the required one (or is it that role)? */
export function includesIn(map: Includes, held: string, required: string): boolean {
  return isStaffRoleIn(map, required) && rolesIncludedByIn(map, held).includes(required)
}

/** Is this role a staff role? */
export function isStaffRole(role: string): boolean {
  return isStaffRoleIn(STAFF_ROLE_INCLUDES, role)
}

/** Every staff role this role includes, itself first. Empty for a non-staff role. */
export function rolesIncludedBy(role: string): StaffRole[] {
  return rolesIncludedByIn(STAFF_ROLE_INCLUDES, role) as StaffRole[]
}

/** Can someone holding this role act as the required one? */
export function includes(held: string, required: AppRole): boolean {
  return includesIn(STAFF_ROLE_INCLUDES, held, required)
}
