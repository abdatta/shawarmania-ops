import { bootSnapshot } from './snapshot'

/**
 * The `role-includes` toggle point for the adapters
 * (staff-roles-include-other-roles, design D7). A data adapter is not a
 * component, so it reads the page's frozen snapshot directly, as the client's
 * request counting does for `tablet-health`. On, each staff check is asked of
 * its `_v2`, which asks which roles include which; off, of the original. Either
 * gives every existing role the same answer.
 */
export function onRoleIncludes(): boolean {
  return bootSnapshot()['role-includes']
}
