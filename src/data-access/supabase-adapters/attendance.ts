import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'

import type {
  AttendanceAdapter,
  AttendanceEvent,
  AttendanceRecord,
  WaitingCount,
} from '../adapters'
import { AttendanceActionError } from '../adapters'
import type { Database } from '../database.types'

/**
 * The real attendance adapter.
 *
 * Every write here sends its evidence and lets the database adjudicate. A
 * check-in always claims `present` and always comes back `absent`, because the
 * fence is evidence and only a recorded approval settles a day. The client's own
 * verdict decides what to *show* someone before they write; it never decides
 * what is recorded.
 *
 * Rows key on the person's account since staff-as-accounts — the join is to
 * `profiles`, and there is no roster table behind it.
 */

const COLUMNS =
  'id, outlet_id, person_id, business_date, status, arrival_deadline, ' +
  'check_in_at, check_in_lat, check_in_lng, check_in_accuracy_m, check_in_distance_m, check_in_source, ' +
  'check_in_entered_by, check_in_entered_by_name, ' +
  'approved_by, approved_by_name, approval_reason, approved_at, ' +
  'approver_lat, approver_lng, approver_accuracy_m, approver_distance_m, ' +
  'profiles!attendance_person_id_fkey!inner(full_name), ' +
  // Named on the row since multi-outlet-people: a person may work a morning at
  // one outlet and an evening at another, so their own history has to say which
  // day was where rather than let the reader assume.
  'outlets!attendance_outlet_id_fkey(name)'

interface JoinedRow {
  id: string
  outlet_id: string
  person_id: string
  business_date: string
  status: AttendanceRecord['status']
  arrival_deadline: string | null
  check_in_at: string | null
  check_in_lat: number | null
  check_in_lng: number | null
  check_in_accuracy_m: number | null
  check_in_distance_m: number | null
  check_in_source: AttendanceEvent['source']
  check_in_entered_by: string | null
  check_in_entered_by_name: string | null
  approved_by: string | null
  approved_by_name: string | null
  approval_reason: string | null
  approved_at: string | null
  approver_lat: number | null
  approver_lng: number | null
  approver_accuracy_m: number | null
  approver_distance_m: number | null
  profiles: { full_name: string } | null
  outlets: { name: string } | null
}

function toRecord(row: JoinedRow): AttendanceRecord {
  return {
    id: row.id,
    outletId: row.outlet_id,
    outletName: row.outlets?.name ?? null,
    personId: row.person_id,
    personName: row.profiles?.full_name ?? '',
    businessDate: row.business_date,
    status: row.status,
    arrivalDeadline: row.arrival_deadline,
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
    // The approver and the time travel together, enforced by
    // attendance_approval_complete; the reason does not, because an on-site
    // approval on the day is not asked for one.
    approval:
      row.approved_by && row.approved_at
        ? {
            by: row.approved_by,
            byName: row.approved_by_name,
            at: row.approved_at,
            reason: row.approval_reason,
            latitude: row.approver_lat,
            longitude: row.approver_lng,
            accuracyMetres: row.approver_accuracy_m,
            distanceMetres: row.approver_distance_m,
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

  if (detail.includes('attendance_one_per_person_outlet_day')) {
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
  if (detail.includes('requires a reason') || detail.includes('approval_reason_not_blank')) {
    return new AttendanceActionError(
      'reason_required',
      'You are not at the outlet, or this day has already closed, so this approval needs a reason.',
    )
  }
  if (detail.includes('an approval requires a check-in')) {
    return new AttendanceActionError(
      'nothing_to_approve',
      'There is no check-in on this day to approve.',
    )
  }
  if (detail.includes('a recorded approval is immutable')) {
    return new AttendanceActionError(
      'already_approved',
      'This day has already been approved. Reload to see who settled it.',
    )
  }
  if (detail.includes('approval') || detail.includes('approved_by')) {
    return new AttendanceActionError(
      'approval_refused',
      'Only a manager for this outlet can approve a check-in.',
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

  async function readMany(ids: readonly string[]): Promise<AttendanceRecord[]> {
    const { data, error } = await table()
      .select(COLUMNS)
      .in('id', ids as string[])
    if (error) throw toActionError(error)
    return (data as unknown as JoinedRow[]).map(toRecord)
  }

  return {
    async getDay(personId, businessDate, outletId) {
      const { data, error } = await table()
        .select(COLUMNS)
        .eq('person_id', personId)
        .eq('business_date', businessDate)
        .eq('outlet_id', outletId)
        .maybeSingle()
      if (error) throw toActionError(error)
      return data ? toRecord(data as unknown as JoinedRow) : null
    },

    async listHistory(personId, from, to) {
      const { data, error } = await table()
        .select(COLUMNS)
        .eq('person_id', personId)
        .gte('business_date', from)
        .lte('business_date', to)
        .order('business_date', { ascending: false })
      if (error) throw toActionError(error)
      return (data as unknown as JoinedRow[]).map(toRecord)
    },

    /**
     * The outlet is filtered here as well as by policy. A read shaped by person
     * is the one that leaks, and a query should mean one thing rather than
     * quietly widening to whatever RLS happens to allow the caller (design D7).
     */
    async listPersonRange(personId, outletId, from, to) {
      const { data, error } = await table()
        .select(COLUMNS)
        .eq('person_id', personId)
        .eq('outlet_id', outletId)
        .gte('business_date', from)
        .lte('business_date', to)
        .order('business_date', { ascending: false })
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

    /**
     * The waiting shape asked for directly rather than derived from a day read:
     * a stranded day can be any date, so counting it means asking the database
     * for exactly the rows that carry an arrival nobody has settled. RLS scopes
     * the answer, so a Franchise Admin gets their own outlets and the owner gets
     * all of them, with no policy added here.
     */
    async countWaitingByOutlet() {
      const { data, error } = await table()
        .select('outlet_id, business_date, outlets!attendance_outlet_id_fkey(name)')
        .not('check_in_at', 'is', null)
        .is('approved_by', null)
        .eq('status', 'absent')
        .order('business_date', { ascending: true })
        .limit(2000)
      if (error) throw toActionError(error)

      const byOutlet = new Map<string, WaitingCount>()
      for (const row of data as unknown as {
        outlet_id: string
        business_date: string
        outlets: { name: string } | null
      }[]) {
        const seen = byOutlet.get(row.outlet_id)
        if (seen) {
          seen.waiting += 1
          // Ascending by date, so the last row seen for an outlet is its newest.
          seen.newest = row.business_date
        } else {
          byOutlet.set(row.outlet_id, {
            outletId: row.outlet_id,
            outletName: row.outlets?.name ?? null,
            waiting: 1,
            // Ascending by date, so the first row for an outlet is its oldest.
            oldest: row.business_date,
            // An outlet with one waiting day is its own oldest and newest.
            newest: row.business_date,
          })
        }
      }
      return [...byOutlet.values()].sort((a, b) =>
        (a.outletName ?? '').localeCompare(b.outletName ?? ''),
      )
    },

    async checkIn({ personId, outletId, businessDate, reading }) {
      const { data, error } = await table()
        .insert({
          outlet_id: outletId,
          person_id: personId,
          business_date: businessDate,
          // The claim, not the verdict. The trigger stores `absent` whatever the
          // coordinates say, because nobody has vouched for the day yet.
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

    /**
     * A manual event carries no coordinates — the admin was not standing where
     * the person was, and the database refuses fabricated evidence anyway. The
     * enterer and approval columns are not sent at all: the guard stamps the
     * writing session for both and would overwrite anything supplied.
     */
    async recordManualEntry({ personId, outletId, businessDate, at }) {
      // One row per person per outlet per day, so the day may already exist as
      // an absent or leave row. Amend it rather than colliding with it; the
      // guard still refuses replacing a check-in that is already recorded.
      const { data: existing, error: findError } = await table()
        .select('id')
        .eq('person_id', personId)
        .eq('outlet_id', outletId)
        .eq('business_date', businessDate)
        .maybeSingle()
      if (findError) throw toActionError(findError)

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
    },

    /**
     * One statement over the selected ids, so a morning is settled together or
     * not at all. The trigger stamps each row's approver name, computes each
     * row's own approver distance from the one reading sent, and applies the
     * reason rule per row — which matters, because a batch can span a day that
     * has closed and a day that has not.
     *
     * `approved_at` is deliberately not sent: when the approval was made is the
     * database's fact, and it stamps it.
     */
    async approve(attendanceIds, { reason, reading, approverId }) {
      if (attendanceIds.length === 0) return []
      const trimmed = reason?.trim() ?? ''

      const { error } = await table()
        .update({
          approved_by: approverId,
          approval_reason: trimmed === '' ? null : trimmed,
          approver_lat: reading?.latitude ?? null,
          approver_lng: reading?.longitude ?? null,
          approver_accuracy_m: reading?.accuracyMetres ?? null,
          status: 'present',
        })
        .in('id', attendanceIds as string[])
      if (error) throw toActionError(error)
      return readMany(attendanceIds)
    },
  }
}
