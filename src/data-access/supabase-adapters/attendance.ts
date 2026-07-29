import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'

import type { AttendanceAdapter, AttendanceEvent, AttendanceRecord } from '../adapters'
import { AttendanceActionError } from '../adapters'
import type { Database } from '../database.types'

/**
 * The real attendance adapter.
 *
 * Every write here sends its evidence and lets the database adjudicate: a
 * check-in always claims `present`, and the geofence trigger stores `absent`
 * instead when the coordinates say otherwise. The client's own verdict decides
 * what to *show* someone before they write; it never decides what is recorded.
 *
 * Rows key on the person's account since staff-as-accounts — the join is to
 * `profiles`, and there is no roster table behind it.
 */

const COLUMNS =
  'id, outlet_id, person_id, business_date, status, ' +
  'check_in_at, check_in_lat, check_in_lng, check_in_accuracy_m, check_in_distance_m, check_in_source, ' +
  'check_in_entered_by, check_in_entered_by_name, ' +
  'check_out_at, check_out_lat, check_out_lng, check_out_accuracy_m, check_out_distance_m, check_out_source, ' +
  'check_out_entered_by, check_out_entered_by_name, ' +
  'override_by, override_by_name, override_reason, override_at, ' +
  'profiles!attendance_person_id_fkey!inner(staff_code, full_name)'

interface JoinedRow {
  id: string
  outlet_id: string
  person_id: string
  business_date: string
  status: AttendanceRecord['status']
  check_in_at: string | null
  check_in_lat: number | null
  check_in_lng: number | null
  check_in_accuracy_m: number | null
  check_in_distance_m: number | null
  check_in_source: AttendanceEvent['source']
  check_in_entered_by: string | null
  check_in_entered_by_name: string | null
  check_out_at: string | null
  check_out_lat: number | null
  check_out_lng: number | null
  check_out_accuracy_m: number | null
  check_out_distance_m: number | null
  check_out_source: AttendanceEvent['source']
  check_out_entered_by: string | null
  check_out_entered_by_name: string | null
  override_by: string | null
  override_by_name: string | null
  override_reason: string | null
  override_at: string | null
  profiles: { staff_code: string | null; full_name: string } | null
}

function toRecord(row: JoinedRow): AttendanceRecord {
  return {
    id: row.id,
    outletId: row.outlet_id,
    personId: row.person_id,
    staffCode: row.profiles?.staff_code ?? null,
    personName: row.profiles?.full_name ?? '',
    businessDate: row.business_date,
    status: row.status,
    checkIn: row.check_in_at
      ? {
          at: row.check_in_at,
          latitude: row.check_in_lat,
          longitude: row.check_in_lng,
          accuracyMetres: row.check_in_accuracy_m,
          distanceMetres: row.check_in_distance_m,
          source: row.check_in_source,
          enteredBy: row.check_in_entered_by,
          enteredByName: row.check_in_entered_by_name,
        }
      : null,
    checkOut: row.check_out_at
      ? {
          at: row.check_out_at,
          latitude: row.check_out_lat,
          longitude: row.check_out_lng,
          accuracyMetres: row.check_out_accuracy_m,
          distanceMetres: row.check_out_distance_m,
          source: row.check_out_source,
          enteredBy: row.check_out_entered_by,
          enteredByName: row.check_out_entered_by_name,
        }
      : null,
    override:
      row.override_by && row.override_at && row.override_reason
        ? {
            by: row.override_by,
            byName: row.override_by_name,
            at: row.override_at,
            reason: row.override_reason,
          }
        : null,
  }
}

/**
 * Turn a Postgres refusal into something worth reading at a counter. The
 * constraint and trigger names are the contract here — they are what the
 * schema chose to call these rules, and matching on them beats matching on
 * prose that a Postgres upgrade may reword.
 */
function toActionError(error: PostgrestError): AttendanceActionError {
  const detail = `${error.message} ${error.details ?? ''}`

  if (detail.includes('attendance_one_per_person_day')) {
    return new AttendanceActionError(
      'already_started',
      'Your day has already been started. Reload to see today’s status.',
    )
  }
  if (detail.includes('outlet is not trading')) {
    return new AttendanceActionError(
      'outlet_closed',
      'This outlet is marked closed, so check-in is not accepted. Ask your manager to reopen it.',
    )
  }
  if (detail.includes('captured check-in evidence is immutable')) {
    return new AttendanceActionError(
      'already_checked_in',
      'A check-in is already recorded for today and cannot be replaced.',
    )
  }
  if (detail.includes('captured check-out evidence is immutable')) {
    return new AttendanceActionError(
      'already_checked_out',
      'A check-out is already recorded for today.',
    )
  }
  if (detail.includes('a manual entry cannot be recorded for the future')) {
    return new AttendanceActionError('future_entry', 'A manual entry cannot be in the future.')
  }
  if (detail.includes('current business day')) {
    return new AttendanceActionError(
      'not_today',
      'A manual entry can only be recorded for the current business day.',
    )
  }
  if (detail.includes('manual entry')) {
    return new AttendanceActionError(
      'manual_refused',
      'Only a manager for this outlet can record an entry on someone’s behalf.',
    )
  }
  if (detail.includes('attendance_override_reason_not_blank')) {
    return new AttendanceActionError('reason_required', 'An override needs a reason.')
  }
  if (detail.includes('override')) {
    return new AttendanceActionError(
      'override_refused',
      'Only a manager for this outlet can clear a blocked check-in.',
    )
  }
  if (error.code === '42501' || error.code === 'PGRST116') {
    return new AttendanceActionError('not_permitted', 'That is not something this account can do.')
  }
  return new AttendanceActionError('failed', 'That did not work. Try again in a moment.')
}

export function createSupabaseAttendanceAdapter(
  client: SupabaseClient<Database>,
): AttendanceAdapter {
  const table = () => client.from('attendance')

  async function readOne(id: string): Promise<AttendanceRecord> {
    const { data, error } = await table().select(COLUMNS).eq('id', id).single()
    if (error) throw toActionError(error)
    return toRecord(data as unknown as JoinedRow)
  }

  return {
    async getDay(personId, businessDate) {
      const { data, error } = await table()
        .select(COLUMNS)
        .eq('person_id', personId)
        .eq('business_date', businessDate)
        .maybeSingle()
      if (error) throw toActionError(error)
      return data ? toRecord(data as unknown as JoinedRow) : null
    },

    async listHistory(personId, limit = 30) {
      const { data, error } = await table()
        .select(COLUMNS)
        .eq('person_id', personId)
        .order('business_date', { ascending: false })
        .limit(limit)
      if (error) throw toActionError(error)
      return (data as unknown as JoinedRow[]).map(toRecord)
    },

    async listOutletDay(outletId, businessDate) {
      const { data, error } = await table()
        .select(COLUMNS)
        .eq('outlet_id', outletId)
        .eq('business_date', businessDate)
      if (error) throw toActionError(error)
      return (data as unknown as JoinedRow[])
        .map(toRecord)
        .sort((a, b) => a.personName.localeCompare(b.personName))
    },

    async checkIn({ personId, outletId, businessDate, reading }) {
      const { data, error } = await table()
        .insert({
          outlet_id: outletId,
          person_id: personId,
          business_date: businessDate,
          // The claim, not the verdict: the trigger stores `absent` instead
          // when the coordinates put this outside the fence.
          status: 'present',
          check_in_at: reading?.at ?? new Date().toISOString(),
          check_in_lat: reading?.latitude ?? null,
          check_in_lng: reading?.longitude ?? null,
          check_in_accuracy_m: reading?.accuracyMetres ?? null,
          check_in_source: 'phone',
        })
        .select('id')
        .single()
      if (error) throw toActionError(error)
      return readOne(data.id)
    },

    async checkOut({ attendanceId, reading }) {
      const { error } = await table()
        .update({
          check_out_at: reading?.at ?? new Date().toISOString(),
          check_out_lat: reading?.latitude ?? null,
          check_out_lng: reading?.longitude ?? null,
          check_out_accuracy_m: reading?.accuracyMetres ?? null,
          check_out_source: 'phone',
        })
        .eq('id', attendanceId)
      if (error) throw toActionError(error)
      return readOne(attendanceId)
    },

    /**
     * A manual event carries no coordinates — the admin was not standing where
     * the person was, and the database refuses fabricated evidence anyway. The
     * enterer columns are not sent at all: the guard stamps the writing
     * session and would overwrite anything supplied.
     */
    async recordManualEntry({ personId, outletId, businessDate, event, at }) {
      // One row per person per day, so the day may already exist — an absent
      // row, or a check-in waiting for its check-out. Amend it rather than
      // colliding with it; the guard still refuses replacing a settled event.
      const { data: existing, error: findError } = await table()
        .select('id')
        .eq('person_id', personId)
        .eq('business_date', businessDate)
        .maybeSingle()
      if (findError) throw toActionError(findError)

      if (event === 'check-in') {
        if (existing) {
          const { error } = await table()
            .update({ status: 'present', check_in_at: at, check_in_source: 'manual' })
            .eq('id', existing.id)
          if (error) throw toActionError(error)
          return readOne(existing.id)
        }
        const { data, error } = await table()
          .insert({
            outlet_id: outletId,
            person_id: personId,
            business_date: businessDate,
            status: 'present',
            check_in_at: at,
            check_in_source: 'manual',
          })
          .select('id')
          .single()
        if (error) throw toActionError(error)
        return readOne(data.id)
      }

      if (!existing) {
        throw new AttendanceActionError('not_started', 'There is no check-in to close.')
      }
      const { error } = await table()
        .update({ check_out_at: at, check_out_source: 'manual' })
        .eq('id', existing.id)
      if (error) throw toActionError(error)
      return readOne(existing.id)
    },

    async approveOverride(attendanceId, reason, approverId) {
      const trimmed = reason.trim()
      if (!trimmed) {
        throw new AttendanceActionError('reason_required', 'An override needs a reason.')
      }

      const { error } = await table()
        .update({
          override_by: approverId,
          override_reason: trimmed,
          override_at: new Date().toISOString(),
          status: 'present',
        })
        .eq('id', attendanceId)
      if (error) throw toActionError(error)
      return readOne(attendanceId)
    },
  }
}
