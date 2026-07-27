import type { SupabaseClient } from '@supabase/supabase-js'

import type { EmployeePatch, EmployeeSummary, EmployeesAdapter, NewEmployee } from '../adapters'
import { AttendanceActionError } from '../adapters'
import type { Database, Tables } from '../database.types'

/**
 * The real roster adapter.
 *
 * `salary_paise` is deliberately neither read nor written here. The roster this
 * change ships is the attendance-facing one — who works at this outlet and
 * whether they still do — and pay is both the most sensitive column on the
 * table and outside what this change was asked for. It keeps its default until
 * a change that means to handle money asks for it.
 */

const COLUMNS =
  'id, outlet_id, profile_id, employee_code, full_name, phone, role_title, employment_status, joined_on'

type Row = Pick<
  Tables<'employees'>,
  | 'id'
  | 'outlet_id'
  | 'profile_id'
  | 'employee_code'
  | 'full_name'
  | 'phone'
  | 'role_title'
  | 'employment_status'
  | 'joined_on'
>

function toSummary(row: Row): EmployeeSummary {
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

export function createSupabaseEmployeesAdapter(
  client: SupabaseClient<Database>,
): EmployeesAdapter {
  const table = () => client.from('employees')

  return {
    async listEmployees(outletId) {
      const { data, error } = await table()
        .select(COLUMNS)
        .eq('outlet_id', outletId)
        .order('full_name')
      if (error) throw error
      return data.map(toSummary)
    },

    async getOwnEmployee() {
      const { data: auth } = await client.auth.getUser()
      const userId = auth.user?.id
      if (!userId) return null

      const { data, error } = await table()
        .select(COLUMNS)
        .eq('profile_id', userId)
        .maybeSingle()
      if (error) throw error
      return data ? toSummary(data) : null
    },

    async createEmployee(employee: NewEmployee) {
      const { data, error } = await table()
        .insert({
          outlet_id: employee.outletId,
          employee_code: employee.employeeCode,
          full_name: employee.fullName,
          phone: employee.phone ?? null,
          role_title: employee.roleTitle ?? null,
          joined_on: employee.joinedOn ?? null,
        })
        .select(COLUMNS)
        .single()
      if (error) {
        if (error.message.includes('employees_code_unique_per_outlet')) {
          throw new AttendanceActionError(
            'code_taken',
            'That employee code is already used at this outlet.',
          )
        }
        throw error
      }
      return toSummary(data)
    },

    async updateEmployee(id, patch: EmployeePatch) {
      const { data, error } = await table()
        .update({
          ...(patch.fullName !== undefined && { full_name: patch.fullName }),
          ...(patch.phone !== undefined && { phone: patch.phone }),
          ...(patch.roleTitle !== undefined && { role_title: patch.roleTitle }),
          ...(patch.employmentStatus !== undefined && {
            employment_status: patch.employmentStatus,
          }),
          ...(patch.joinedOn !== undefined && { joined_on: patch.joinedOn }),
        })
        .eq('id', id)
        .select(COLUMNS)
        .single()
      if (error) throw error
      return toSummary(data)
    },
  }
}
