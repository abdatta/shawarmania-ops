import type { AccountSummary, EmployeeSummary, EmployeesAdapter } from '../adapters'
import { AttendanceActionError, DataActionError } from '../adapters'
import { employeeFixtures } from './fixtures/employees'
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

export function createMockEmployeesAdapter(accounts: AccountSummary[]): EmployeesAdapter {
  const employees: StoredEmployee[] = employeeFixtures.map(toStored)
  let nextId = 1

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
      const code = employee.employeeCode.trim()
      if (!code) {
        throw new DataActionError(
          'code_required',
          'A staff code is needed — it is how this person’s records are identified.',
        )
      }
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
      Object.assign(employee, {
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
