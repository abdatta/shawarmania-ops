import type { EmployeeSummary, EmployeesAdapter } from '../adapters'
import { AttendanceActionError } from '../adapters'
import { employeeFixtures } from './fixtures/employees'
import { personaFixtures } from './fixtures/personas'

/**
 * The mock roster adapter. Stateful, so the demo can show a row being added
 * rather than describing one.
 *
 * `getOwnEmployee` resolves the Employee persona's roster row — the link that
 * turns the fourth role's walkthrough into a working day.
 */

function toSummary(row: (typeof employeeFixtures)[number]): EmployeeSummary {
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

export function createMockEmployeesAdapter(): EmployeesAdapter {
  const employees: EmployeeSummary[] = employeeFixtures.map(toSummary)
  let nextId = 1

  const find = (id: string): EmployeeSummary => {
    const employee = employees.find((candidate) => candidate.id === id)
    if (!employee) throw new Error(`No demo employee: ${id}`)
    return employee
  }

  return {
    async listEmployees(outletId) {
      return employees
        .filter((employee) => employee.outletId === outletId)
        .sort((a, b) => a.fullName.localeCompare(b.fullName))
        .map((employee) => structuredClone(employee))
    },

    async getOwnEmployee() {
      const own = employees.find(
        (employee) => employee.profileId === personaFixtures.employee.profile.id,
      )
      return own ? structuredClone(own) : null
    },

    async createEmployee(employee) {
      const code = employee.employeeCode.trim()
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

      const created: EmployeeSummary = {
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
      employees.push(created)
      return structuredClone(created)
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
      return structuredClone(employee)
    },
  }
}
