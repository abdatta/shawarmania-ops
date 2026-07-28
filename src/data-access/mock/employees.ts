import type { AccountSummary, AppRole, EmployeeSummary, EmployeesAdapter } from '../adapters'
import { AttendanceActionError, DataActionError } from '../adapters'
import { employeeFixtures } from './fixtures/employees'
import { outletFixtures } from './fixtures/outlets'
import { personaFixtures } from './fixtures/personas'

/**
 * The mock roster adapter. Stateful, so the demo can show a row being added
 * rather than describing one.
 *
 * `getOwnEmployee` resolves the Employee persona's roster row — the link that
 * turns the fourth role's walkthrough into a working day.
 *
 * The account list is handed in rather than copied, so `linkedAccount` reads
 * live state: an account deactivated on Access shows as deactivated on Staff
 * without either screen knowing about the other. It refuses the same two
 * things the database refuses — a cross-outlet link and a second link to one
 * account — because a demo that accepts a write the real stack rejects teaches
 * the wrong thing about the product.
 */

/**
 * The alphabet the real generator uses — Crockford base32, the digits and
 * letters minus I, L, O and U. Shared with `invite-code.ts` and with
 * `random_staff_suffix()` in Postgres. Not an aesthetic choice: these codes are
 * read aloud across a counter, and 0/O and 1/I/L are the confusions it exists
 * to prevent.
 */
const SUFFIX_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** A roster row before its linked account is resolved. */
type StoredEmployee = Omit<EmployeeSummary, 'linkedAccount'>

function toStored(row: (typeof employeeFixtures)[number]): StoredEmployee {
  return {
    id: row.id,
    outletId: row.outlet_id,
    profileId: row.profile_id,
    employeeCode: row.employee_code,
    fullName: row.full_name,
    phone: row.phone,
    roleTitle: row.role_title,
    employmentStatus: row.employment_status,
    joinedOn: row.joined_on,
  }
}

export function createMockEmployeesAdapter(
  accounts: AccountSummary[],
  /**
   * Who is looking. The demo tree passes the persona's role so the mock can
   * refuse a staff-code change the same way `employee_code_guard` does — the
   * boundary is owner-only, and a demo that let a manager through would teach a
   * product this one is not. Defaults to the owner, which is the unrestricted
   * case and what a test wants unless it says otherwise.
   */
  role: AppRole = 'super_admin',
): EmployeesAdapter {
  const employees: StoredEmployee[] = employeeFixtures.map(toStored)
  let nextId = 1

  /**
   * Deterministic, and deliberately not random.
   *
   * The real generator draws four characters at random; a mock that did the
   * same would make snapshot tests flake and a demo walkthrough unrepeatable —
   * two things this repo's demo mode explicitly sells. So the sequence is fixed
   * per adapter instance: same codes every run, right shape, no `Math.random()`.
   * Follows the `nextId` precedent directly above.
   *
   * The stride is a prime so consecutive codes do not read as `0001`, `0002` —
   * an issued code that looks like a serial invites somebody to treat it as
   * one, which is exactly what the real design rejected (its D3).
   */
  let suffixSeed = 0
  function nextSuffix(): string {
    suffixSeed += 1
    let n = (suffixSeed * 7919) % 32 ** 4
    let out = ''
    for (let i = 0; i < 4; i += 1) {
      out = SUFFIX_ALPHABET[n % 32] + out
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
      if (!employees.some((row) => row.outletId === outletId && row.employeeCode === candidate)) {
        return candidate
      }
    }
    throw new Error(`Could not issue a staff code for outlet ${outletId}`)
  }

  const find = (id: string): StoredEmployee => {
    const employee = employees.find((candidate) => candidate.id === id)
    if (!employee) throw new Error(`No demo employee: ${id}`)
    return employee
  }

  function resolve(employee: StoredEmployee): EmployeeSummary {
    const account = accounts.find((candidate) => candidate.id === employee.profileId)
    return structuredClone({
      ...employee,
      linkedAccount: account
        ? { id: account.id, fullName: account.fullName, isActive: account.isActive }
        : null,
    })
  }

  /** The two refusals the database makes, made here for the same reasons. */
  function checkLinkable(employee: StoredEmployee, profileId: string) {
    const account = accounts.find((candidate) => candidate.id === profileId)
    if (!account || account.outletId !== employee.outletId) {
      throw new DataActionError(
        'wrong_outlet',
        'That account belongs to a different outlet, so it cannot be linked here.',
      )
    }
    if (employees.some((other) => other.id !== employee.id && other.profileId === profileId)) {
      throw new DataActionError(
        'account_linked',
        'That account is already on the roster as somebody else. Unlink it there first.',
      )
    }
  }

  return {
    async listEmployees(outletId) {
      return employees
        .filter((employee) => employee.outletId === outletId)
        .sort((a, b) => a.fullName.localeCompare(b.fullName))
        .map(resolve)
    },

    async getOwnEmployee() {
      const own = employees.find(
        (employee) => employee.profileId === personaFixtures.employee.profile.id,
      )
      return own ? resolve(own) : null
    },

    async createEmployee(employee) {
      // Blank and absent are the same thing here, as they are in the trigger:
      // null, '' and '   ' all mean *issue me one*. The old `code_required`
      // refusal is gone from this path entirely — it now fires only where the
      // database's does, on a blank supplied while editing.
      const supplied = employee.employeeCode?.trim() ?? ''
      const code = supplied || issueCode(employee.outletId)
      if (
        employees.some(
          (existing) => existing.outletId === employee.outletId && existing.employeeCode === code,
        )
      ) {
        throw new AttendanceActionError(
          'code_taken',
          'That employee code is already used at this outlet.',
        )
      }

      const created: StoredEmployee = {
        id: `d2000000-0000-4000-b000-${String(nextId++).padStart(12, '0')}`,
        outletId: employee.outletId,
        profileId: null,
        employeeCode: code,
        fullName: employee.fullName,
        phone: employee.phone ?? null,
        roleTitle: employee.roleTitle ?? null,
        employmentStatus: 'active',
        joinedOn: employee.joinedOn ?? null,
      }
      if (employee.profileId) checkLinkable(created, employee.profileId)
      created.profileId = employee.profileId ?? null

      employees.push(created)
      return resolve(created)
    },

    async updateEmployee(id, patch) {
      const employee = find(id)

      if (patch.employeeCode !== undefined && patch.employeeCode !== employee.employeeCode) {
        // Mirrors `employee_code_guard`. The Staff form also disables the field
        // for a manager, but that is the convenience — this is the boundary,
        // and the demo should show the same one the real stack enforces.
        if (role !== 'super_admin') {
          throw new DataActionError('code_not_yours', 'Only the owner can change a staff code.')
        }
        const next = patch.employeeCode.trim()
        // Still refused on update, unlike on insert: the row already has a
        // code, so clearing it is a mistake rather than a request to re-issue.
        if (!next) {
          throw new DataActionError(
            'code_required',
            'A staff code is needed — it is how this person’s records are identified.',
          )
        }
        if (
          employees.some(
            (other) =>
              other.id !== id &&
              other.outletId === employee.outletId &&
              other.employeeCode === next,
          )
        ) {
          throw new AttendanceActionError(
            'code_taken',
            'That employee code is already used at this outlet.',
          )
        }
      }

      Object.assign(employee, {
        ...(patch.employeeCode !== undefined && { employeeCode: patch.employeeCode.trim() }),
        ...(patch.fullName !== undefined && { fullName: patch.fullName }),
        ...(patch.phone !== undefined && { phone: patch.phone }),
        ...(patch.roleTitle !== undefined && { roleTitle: patch.roleTitle }),
        ...(patch.employmentStatus !== undefined && { employmentStatus: patch.employmentStatus }),
        ...(patch.joinedOn !== undefined && { joinedOn: patch.joinedOn }),
      })
      return resolve(employee)
    },

    async linkAccount(employeeId, profileId) {
      const employee = find(employeeId)
      checkLinkable(employee, profileId)
      employee.profileId = profileId
      return resolve(employee)
    },

    async unlinkAccount(employeeId) {
      const employee = find(employeeId)
      employee.profileId = null
      return resolve(employee)
    },
  }
}
