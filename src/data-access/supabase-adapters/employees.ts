import type { SupabaseClient } from '@supabase/supabase-js'

import type { EmployeePatch, EmployeeSummary, EmployeesAdapter, NewEmployee } from '../adapters'
import { AttendanceActionError, DataActionError } from '../adapters'
import type { Database, Tables } from '../database.types'

/**
 * The real roster adapter.
 *
 * `salary_paise` is deliberately neither read nor written here. The roster this
 * change ships is the attendance-facing one — who works at this outlet and
 * whether they still do — and pay is both the most sensitive column on the
 * table and outside what this change was asked for. It keeps its default until
 * a change that means to handle money asks for it.
 *
 * `profile_id` is the column that makes an Employee's own attendance findable
 * at all, and until outlet-and-staff-setup nothing in the app ever wrote it.
 * The link is an ordinary outlet-scoped write governed by `employees_update`
 * and the `employee_profile_same_outlet` trigger — never a privileged call
 * (design D3).
 */

/**
 * The linked account is read through an embed rather than joined in a screen,
 * because `getOwnEmployee` needs it too and an Employee has no permission to
 * list accounts (design D7). RLS filters the embed exactly as it filters a
 * direct read: an Employee sees their own profile, which is the only one their
 * own row could point at.
 */
const COLUMNS =
  'id, outlet_id, profile_id, employee_code, full_name, phone, role_title, employment_status, joined_on, profiles!employees_profile_id_fkey (id, full_name, is_active)'

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
> & {
  profiles: Pick<Tables<'profiles'>, 'id' | 'full_name' | 'is_active'> | null
}

function toSummary(row: Row): EmployeeSummary {
  return {
    id: row.id,
    outletId: row.outlet_id,
    profileId: row.profile_id,
    linkedAccount: row.profiles
      ? {
          id: row.profiles.id,
          fullName: row.profiles.full_name,
          isActive: row.profiles.is_active,
        }
      : null,
    employeeCode: row.employee_code,
    fullName: row.full_name,
    phone: row.phone,
    roleTitle: row.role_title,
    employmentStatus: row.employment_status,
    joinedOn: row.joined_on,
  }
}

/**
 * Both link refusals are refusals a person will actually cause, and both read
 * as gibberish in their raw form.
 */
function asRosterError(error: { message: string; code?: string }): unknown {
  if (error.message.includes('employees_code_not_blank')) {
    return new DataActionError(
      'code_required',
      'A staff code is needed — it is how this person’s records are identified.',
    )
  }
  if (error.message.includes('employees_code_unique_per_outlet')) {
    return new AttendanceActionError(
      'code_taken',
      'That employee code is already used at this outlet.',
    )
  }
  if (error.message.includes('employees_profile_id_key') || error.code === '23505') {
    return new DataActionError(
      'account_linked',
      'That account is already on the roster as somebody else. Unlink it there first.',
    )
  }
  if (error.message.includes('linked profile must belong')) {
    return new DataActionError(
      'wrong_outlet',
      'That account belongs to a different outlet, so it cannot be linked here.',
    )
  }
  return error
}

export function createSupabaseEmployeesAdapter(client: SupabaseClient<Database>): EmployeesAdapter {
  const table = () => client.from('employees')

  async function writeLink(id: string, profileId: string | null): Promise<EmployeeSummary> {
    const { data, error } = await table()
      .update({ profile_id: profileId })
      .eq('id', id)
      .select(COLUMNS)
      .single()
    if (error) throw asRosterError(error)
    return toSummary(data)
  }

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

      const { data, error } = await table().select(COLUMNS).eq('profile_id', userId).maybeSingle()
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
          profile_id: employee.profileId ?? null,
        })
        .select(COLUMNS)
        .single()
      if (error) throw asRosterError(error)
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
      if (error) throw asRosterError(error)
      return toSummary(data)
    },

    async linkAccount(employeeId, profileId) {
      return await writeLink(employeeId, profileId)
    },

    async unlinkAccount(employeeId) {
      return await writeLink(employeeId, null)
    },
  }
}
