import { Users } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'

import { DataTable, type DataTableColumn } from '@/components/layout/data-table'
import { EmptyState } from '@/components/layout/empty-state'
import { FormSheet } from '@/components/layout/form-sheet'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { buttonVariants } from '@/components/ui/button-variants'
import { Input } from '@/components/ui/input'
import { useAdapters } from '@/data-access'
import { AttendanceActionError, type EmployeeSummary, type EmploymentStatus } from '@/data-access/adapters'
import { formatBusinessDate } from '@/domain'
import { useSession } from '@/session/context'

/**
 * Staff — the HR roster for one outlet.
 *
 * Deliberately not the same thing as Access. Having a login and being on the
 * payroll are different facts about a person, and one can be true without the
 * other: a griller who never touches the app is still on this list, and that is
 * what makes them checkable-in from the counter tablet later.
 *
 * Pay is not on this screen. The roster this change ships is the
 * attendance-facing one, and salary is both the most sensitive column on the
 * table and outside what was asked for.
 */

const STATUS_LABELS = {
  active: 'Active',
  inactive: 'Inactive',
  terminated: 'Left',
} as const satisfies Record<EmploymentStatus, string>

interface Draft {
  employeeCode: string
  fullName: string
  phone: string
  roleTitle: string
  joinedOn: string
}

const EMPTY_DRAFT: Draft = {
  employeeCode: '',
  fullName: '',
  phone: '',
  roleTitle: '',
  joinedOn: '',
}

export function EmployeeRoster() {
  const session = useSession()
  const { employees: adapter } = useAdapters()

  const [roster, setRoster] = useState<EmployeeSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<EmployeeSummary | null>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)

  const outletId = session.outletId

  useEffect(() => {
    if (!outletId) return
    let active = true
    void adapter
      .listEmployees(outletId)
      .then((list) => {
        if (active) setRoster(list)
      })
      .catch(() => {
        if (active) setError('Could not load the staff list. Try again in a moment.')
      })
    return () => {
      active = false
    }
  }, [adapter, outletId])

  async function run(action: () => Promise<unknown>) {
    if (!outletId) return
    setBusy(true)
    setError(null)
    try {
      await action()
      setRoster(await adapter.listEmployees(outletId))
    } catch (cause) {
      setError(
        cause instanceof AttendanceActionError
          ? cause.message
          : 'That did not work. Try again in a moment.',
      )
    } finally {
      setBusy(false)
    }
  }

  function openAdd() {
    setEditing(null)
    setDraft(EMPTY_DRAFT)
    setFormOpen(true)
  }

  function openEdit(employee: EmployeeSummary) {
    setEditing(employee)
    setDraft({
      employeeCode: employee.employeeCode,
      fullName: employee.fullName,
      phone: employee.phone ?? '',
      roleTitle: employee.roleTitle ?? '',
      joinedOn: employee.joinedOn ?? '',
    })
    setFormOpen(true)
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!outletId) return

    await run(async () => {
      if (editing) {
        await adapter.updateEmployee(editing.id, {
          fullName: draft.fullName,
          phone: draft.phone.trim() || null,
          roleTitle: draft.roleTitle.trim() || null,
          joinedOn: draft.joinedOn || null,
        })
      } else {
        await adapter.createEmployee({
          outletId,
          employeeCode: draft.employeeCode,
          fullName: draft.fullName,
          phone: draft.phone.trim() || null,
          roleTitle: draft.roleTitle.trim() || null,
          joinedOn: draft.joinedOn || null,
        })
      }
      setFormOpen(false)
    })
  }

  const columns: DataTableColumn<EmployeeSummary>[] = [
    {
      id: 'name',
      header: 'Name',
      cell: (row) => (
        <span>
          <span className="font-semibold text-content">{row.fullName}</span>
          <span className="block text-xs text-content-muted">
            {row.employeeCode}
            {row.roleTitle ? ` · ${row.roleTitle}` : ''}
          </span>
        </span>
      ),
    },
    {
      id: 'joined',
      header: 'Joined',
      cell: (row) => (row.joinedOn ? formatBusinessDate(row.joinedOn) : '—'),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (row) => (
        <span className={row.employmentStatus === 'active' ? 'text-content' : 'text-content-muted'}>
          {STATUS_LABELS[row.employmentStatus]}
        </span>
      ),
    },
    {
      id: 'actions',
      header: 'Actions',
      align: 'right',
      cell: (row) => (
        <span className="flex justify-end gap-1">
          <Button variant="ghost" size="phone" disabled={busy} onClick={() => openEdit(row)}>
            Edit
          </Button>
          {row.employmentStatus === 'active' ? (
            <Button
              variant="ghost"
              size="phone"
              disabled={busy}
              onClick={() =>
                void run(() => adapter.updateEmployee(row.id, { employmentStatus: 'terminated' }))
              }
            >
              Mark left
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="phone"
              disabled={busy}
              onClick={() =>
                void run(() => adapter.updateEmployee(row.id, { employmentStatus: 'active' }))
              }
            >
              Reinstate
            </Button>
          )}
        </span>
      ),
    },
  ]

  if (!outletId) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title="Staff" />
        <EmptyState icon={Users} title="This account is not assigned to an outlet." />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Staff"
        subtitle="Who works at this outlet. Separate from app accounts — someone can be on this list without a login."
        action={
          <button type="button" className={buttonVariants({ size: 'phone' })} onClick={openAdd}>
            Add person
          </button>
        }
      />

      {error && (
        <p role="alert" data-testid="roster-error" className="mb-3 text-sm font-semibold text-danger">
          {error}
        </p>
      )}

      {roster === null ? (
        <p className="text-sm text-content-muted">Loading…</p>
      ) : (
        <DataTable
          columns={columns}
          rows={roster}
          rowKey={(row) => row.id}
          empty={
            <EmptyState
              icon={Users}
              title="Nobody on the list yet. Add the people who work here — attendance follows this list, not app accounts."
            />
          }
        />
      )}

      <FormSheet
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? 'Edit person' : 'Add person'}
        footer={
          <button
            type="submit"
            form="employee-form"
            disabled={busy}
            className={`${buttonVariants({ size: 'phone' })} w-full`}
          >
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Add to the list'}
          </button>
        }
      >
        <form id="employee-form" onSubmit={onSubmit} className="space-y-4" noValidate>
          <Field label="Full name" id="employee-name">
            <Input
              id="employee-name"
              required
              value={draft.fullName}
              onChange={(event) => setDraft({ ...draft, fullName: event.target.value })}
            />
          </Field>

          <Field label="Staff code" id="employee-code">
            <Input
              id="employee-code"
              required
              autoCapitalize="characters"
              disabled={editing !== null}
              value={draft.employeeCode}
              onChange={(event) => setDraft({ ...draft, employeeCode: event.target.value })}
            />
            {editing && (
              <p className="text-xs text-content-muted">
                A staff code identifies past records and does not change.
              </p>
            )}
          </Field>

          <Field label="Role (optional)" id="employee-role">
            <Input
              id="employee-role"
              value={draft.roleTitle}
              placeholder="Grill, counter, prep…"
              onChange={(event) => setDraft({ ...draft, roleTitle: event.target.value })}
            />
          </Field>

          <Field label="Phone (optional)" id="employee-phone">
            <Input
              id="employee-phone"
              type="tel"
              value={draft.phone}
              onChange={(event) => setDraft({ ...draft, phone: event.target.value })}
            />
          </Field>

          <Field label="Joined on (optional)" id="employee-joined">
            <Input
              id="employee-joined"
              type="date"
              value={draft.joinedOn}
              onChange={(event) => setDraft({ ...draft, joinedOn: event.target.value })}
            />
          </Field>
        </form>
      </FormSheet>
    </div>
  )
}

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-semibold">
        {label}
      </label>
      {children}
    </div>
  )
}
