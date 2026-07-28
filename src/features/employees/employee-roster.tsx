import { CircleAlert, Users } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'

import { ConfirmDialog } from '@/components/layout/confirm-dialog'
import { DataTable, type DataTableColumn } from '@/components/layout/data-table'
import { EmptyState } from '@/components/layout/empty-state'
import { FormSheet } from '@/components/layout/form-sheet'
import { PageHeader } from '@/components/layout/page-header'
import { AddButton } from '@/components/ui/add-button'
import { Button } from '@/components/ui/button'
import { buttonVariants } from '@/components/ui/button-variants'
import { Input } from '@/components/ui/input'
import { useAdapters, type Tables } from '@/data-access'
import {
  DataActionError,
  type AccountSummary,
  type EmployeeSummary,
  type EmploymentStatus,
} from '@/data-access/adapters'
import { formatBusinessDate } from '@/domain'
import { useSession } from '@/session/context'

/**
 * Staff — the HR roster for one outlet, and where an app account is joined to
 * the person it belongs to.
 *
 * Deliberately not the same thing as Access. Having a login and being on the
 * payroll are different facts about a person, and one can be true without the
 * other: a griller who never touches the app is still on this list, and that is
 * what makes them checkable-in from the counter tablet later.
 *
 * The link between the two is what this screen exists for. `employees.
 * profile_id` is how an Employee's own attendance is found at all, nothing in
 * the app ever wrote it before outlet-and-staff-setup, and the consequence was
 * an attendance feature that no real employee could reach. So the list answers
 * *"can this person actually check in?"* on its face — that question gets asked
 * on a phone call during a shift, and it must not require a database.
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
  /** Empty means "nobody yet"; only ever sets a link, never removes one. */
  profileId: string
}

const EMPTY_DRAFT: Draft = {
  employeeCode: '',
  fullName: '',
  phone: '',
  roleTitle: '',
  joinedOn: '',
  profileId: '',
}

interface Loaded {
  outletId: string
  roster: EmployeeSummary[]
  accounts: AccountSummary[]
}

export function EmployeeRoster() {
  const session = useSession()
  const { employees: adapter, accounts: accountsAdapter, outlets: outletsAdapter } = useAdapters()

  // The Super Admin is outlet-less by constraint, so they choose; everyone else
  // has exactly one outlet and no choice to make (design D6).
  const isOwner = session.role === 'super_admin'
  const [outlets, setOutlets] = useState<Tables<'outlets'>[]>([])
  const [chosenOutletId, setChosenOutletId] = useState<string | null>(null)
  const outletId = session.outletId ?? chosenOutletId ?? outlets[0]?.id ?? null

  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<EmployeeSummary | null>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [pendingUnlink, setPendingUnlink] = useState<EmployeeSummary | null>(null)

  useEffect(() => {
    if (!isOwner) return
    let active = true
    void outletsAdapter
      .listOutlets({ includeInactive: true })
      .then((list) => {
        if (active) setOutlets(list)
      })
      .catch(() => {
        if (active) setError('Could not load outlets. Try again in a moment.')
      })
    return () => {
      active = false
    }
  }, [isOwner, outletsAdapter])

  useEffect(() => {
    if (!outletId) return
    let active = true
    void Promise.all([adapter.listEmployees(outletId), accountsAdapter.listAccounts()])
      .then(([roster, accounts]) => {
        if (active) setLoaded({ outletId, roster, accounts })
      })
      .catch(() => {
        if (active) setError('Could not load the staff list. Try again in a moment.')
      })
    return () => {
      active = false
    }
  }, [adapter, accountsAdapter, outletId])

  // Derived rather than reset in an effect: a stale list belongs to the outlet
  // it was loaded for, and the loading state is simply "not that one yet".
  const roster = loaded?.outletId === outletId ? loaded.roster : null

  /** Active accounts at this outlet that no roster row has claimed. */
  const availableAccounts = useMemo(() => {
    if (!loaded || loaded.outletId !== outletId) return []
    const taken = new Set(loaded.roster.map((row) => row.profileId).filter(Boolean))
    return loaded.accounts.filter(
      (account) => account.outletId === outletId && account.isActive && !taken.has(account.id),
    )
  }, [loaded, outletId])

  async function run(action: () => Promise<unknown>) {
    if (!outletId) return
    setBusy(true)
    setError(null)
    try {
      await action()
      // Only the roster is re-read. Nothing this screen does creates, renames
      // or deactivates an account — linking moves the roster's end of the
      // relationship — so re-fetching the account list would be a round trip
      // for an answer that cannot have changed.
      const nextRoster = await adapter.listEmployees(outletId)
      setLoaded((current) => ({
        outletId,
        roster: nextRoster,
        accounts: current?.accounts ?? [],
      }))
    } catch (cause) {
      setError(
        cause instanceof DataActionError
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
    setError(null)
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
      profileId: employee.profileId ?? '',
    })
    setError(null)
    setFormOpen(true)
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!outletId) return

    // A staff code identifies this person's records for years, so a blank one
    // is a missing answer rather than an empty value. The database refuses it
    // too; this is the sentence a person can act on.
    if (!editing && !draft.employeeCode.trim()) {
      setError('A staff code is needed — it is how this person’s records are identified.')
      return
    }

    await run(async () => {
      if (editing) {
        await adapter.updateEmployee(editing.id, {
          fullName: draft.fullName,
          phone: draft.phone.trim() || null,
          roleTitle: draft.roleTitle.trim() || null,
          joinedOn: draft.joinedOn || null,
        })
        // Only ever an addition here. Removing a link is a row action with its
        // own confirmation, because it stops somebody checking in.
        if (draft.profileId && draft.profileId !== editing.profileId) {
          await adapter.linkAccount(editing.id, draft.profileId)
        }
      } else {
        await adapter.createEmployee({
          outletId,
          employeeCode: draft.employeeCode,
          fullName: draft.fullName,
          phone: draft.phone.trim() || null,
          roleTitle: draft.roleTitle.trim() || null,
          joinedOn: draft.joinedOn || null,
          profileId: draft.profileId || null,
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
      id: 'account',
      header: 'App account',
      cell: (row) => <AccountCell employee={row} />,
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
          {row.linkedAccount && (
            <Button
              variant="ghost"
              size="phone"
              disabled={busy}
              onClick={() => setPendingUnlink(row)}
            >
              Unlink
            </Button>
          )}
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
        <EmptyState
          icon={Users}
          title={
            isOwner
              ? 'No outlet exists yet. Create one on the Outlets screen — a staff list belongs to a shop.'
              : 'This account is not assigned to an outlet.'
          }
        />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Staff"
        subtitle="Who works at this outlet. Separate from app accounts — someone can be on this list without a login, and the other way round."
        action={<AddButton label="Add person" onClick={openAdd} />}
      />

      {isOwner && outlets.length > 0 && (
        <div className="mb-4 space-y-1">
          <label htmlFor="roster-outlet" className="block text-sm font-semibold">
            Outlet
          </label>
          <select
            id="roster-outlet"
            className="h-[var(--size-control)] w-full rounded-lg border border-border bg-surface px-3 text-content focus-visible:focus-ring"
            value={outletId}
            onChange={(event) => setChosenOutletId(event.target.value)}
          >
            {outlets.map((outlet) => (
              <option key={outlet.id} value={outlet.id}>
                {outlet.name}
                {outlet.is_active ? '' : ' (closed)'}
              </option>
            ))}
          </select>
        </div>
      )}

      {error && (
        <p
          role="alert"
          data-testid="roster-error"
          className="mb-3 text-sm font-semibold text-danger"
        >
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

          <Field label="App account" id="employee-account">
            {editing?.linkedAccount ? (
              <p
                data-testid="linked-account-note"
                className="rounded-lg border border-border bg-surface-raised p-2 text-sm text-content"
              >
                Signs in as <strong>{editing.linkedAccount.fullName}</strong>. To separate them, use{' '}
                <em>Unlink</em> on the staff list — it stops this person checking in.
              </p>
            ) : (
              <>
                <select
                  id="employee-account"
                  className="h-[var(--size-control)] w-full rounded-lg border border-border bg-surface px-3 text-content focus-visible:focus-ring"
                  value={draft.profileId}
                  onChange={(event) => setDraft({ ...draft, profileId: event.target.value })}
                >
                  <option value="">Nobody yet — no login</option>
                  {availableAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.fullName}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-content-muted">
                  {availableAccounts.length === 0
                    ? 'Every account at this outlet is already on the list. Create one on Access first if this person needs to check in from their own phone.'
                    : 'Without a linked account this person cannot check in from their own phone. They can still be checked in from the counter.'}
                </p>
              </>
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

      <ConfirmDialog
        open={pendingUnlink !== null}
        title="Separate this account from this person?"
        consequence={
          pendingUnlink
            ? `${pendingUnlink.linkedAccount?.fullName ?? 'That account'} stops being able to check in or see their own attendance. Every day already recorded against ${pendingUnlink.fullName} stays on the staff list, because those days were worked. The account itself is untouched and can be linked to somebody else.`
            : ''
        }
        confirmLabel="Unlink"
        danger
        onClose={() => setPendingUnlink(null)}
        onConfirm={() => {
          const target = pendingUnlink
          setPendingUnlink(null)
          if (target) void run(() => adapter.unlinkAccount(target.id))
        }}
      />
    </div>
  )
}

/**
 * The answer to "why can this person not check in?", on the row where the
 * question gets asked.
 */
function AccountCell({ employee }: { employee: EmployeeSummary }) {
  if (!employee.linkedAccount) {
    return (
      <span
        data-testid={`unlinked-${employee.employeeCode}`}
        className="inline-flex items-start gap-1 text-xs text-content-muted"
      >
        <CircleAlert aria-hidden size={13} className="mt-0.5 shrink-0 text-warning" />
        No app account — cannot check in from a phone
      </span>
    )
  }

  if (!employee.linkedAccount.isActive) {
    return (
      <span
        data-testid={`deactivated-${employee.employeeCode}`}
        className="inline-flex items-start gap-1 text-xs text-content"
      >
        <CircleAlert aria-hidden size={13} className="mt-0.5 shrink-0 text-danger" />
        {employee.linkedAccount.fullName} — account deactivated, cannot sign in
      </span>
    )
  }

  return (
    <span data-testid={`linked-${employee.employeeCode}`} className="text-xs text-content">
      {employee.linkedAccount.fullName}
    </span>
  )
}

function Field({ label, id, children }: { label: string; id: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-semibold">
        {label}
      </label>
      {children}
    </div>
  )
}
