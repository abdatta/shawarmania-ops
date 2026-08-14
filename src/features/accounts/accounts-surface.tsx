import { Users } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'

import { ConfirmDialog } from '@/components/layout/confirm-dialog'
import { DataTable, type DataTableColumn } from '@/components/layout/data-table'
import { EmptyState } from '@/components/layout/empty-state'
import { FormSheet } from '@/components/layout/form-sheet'
import { PageHeader } from '@/components/layout/page-header'
import { RowActionsMenu } from '@/components/layout/row-actions-menu'
import { AddButton } from '@/components/ui/add-button'
import { Button } from '@/components/ui/button'
import { buttonVariants } from '@/components/ui/button-variants'
import { Input } from '@/components/ui/input'
import { LoadingTable } from '@/components/ui/loading'
import { Select } from '@/components/ui/select'
import { useAdapters, type Tables } from '@/data-access'
import {
  DataActionError,
  FAILED_ACTIVATION_NOTICE,
  liveAssignments,
  STAFF_ROLES,
  type AccountHandover,
  type AccountSummary,
  type AppRole,
} from '@/data-access/adapters'
import { useSession } from '@/session/context'
import { holdsRole, ROLE_LABELS, sessionOutletsFor } from '@/session/session'
import { validateUsername, usernameErrorMessage } from '../../../shared/username'

import { AccountHandoverPanel } from './account-handover'

/**
 * People — every person, for the Super Admin across all outlets and for a
 * Franchise Admin their own. One component: the difference between the two is
 * entirely the caller's authority, and writing it twice would be writing the
 * authority rules twice.
 *
 * Staff exist only as accounts. Creating a person here is one act — the
 * account, the staff-list membership and the issued staff code all arrive
 * together, and there is no separate roster surface and no linking step.
 *
 * What the UI restricts here is convenience, not security. A Franchise Admin
 * is offered no role beyond Biller and Employee and no outlet but their own —
 * and the privileged function refuses those combinations again on the server,
 * from the caller's own token, whatever this form sends (design D5). The same
 * split governs edits: staff facts are the admin's own RLS write, and access
 * changes go through the privileged function.
 */

const ROLE_ORDER: AppRole[] = ['super_admin', 'franchise_admin', 'biller', 'employee']

interface Draft {
  fullName: string
  username: string
  accountEmail: string
  phone: string
  role: AppRole
  outletIds: string[]
  roleTitle: string
  joinedOn: string
}
interface AssignmentDraft {
  assignmentId: string | null
  outletId: string
  role: Exclude<AppRole, 'super_admin'>
  startedOn: string
}

type OrdinaryAssignment = Exclude<
  ReturnType<typeof liveAssignments>[number],
  { role: 'super_admin' }
> & { outletId: string; role: Exclude<AppRole, 'super_admin'> }

const ORDINARY_ROLES: Exclude<AppRole, 'super_admin'>[] = ['franchise_admin', 'biller', 'employee']

function todayInIndia() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((current) => current.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

export function AccountsSurface() {
  const session = useSession()
  const { accounts: adapter, outlets: outletsAdapter } = useAdapters()

  const isOwner = holdsRole(session, 'super_admin')
  const assignableRoles = useMemo<AppRole[]>(
    () => (isOwner ? ROLE_ORDER : ['biller', 'employee']),
    [isOwner],
  )

  const [accounts, setAccounts] = useState<AccountSummary[] | null>(null)
  const [outlets, setOutlets] = useState<Tables<'outlets'>[]>([])
  const [error, setError] = useState<string | null>(null)
  const [issued, setIssued] = useState<{
    handover: AccountHandover
    name: string
    replacement?: boolean
  } | null>(null)
  const [correcting, setCorrecting] = useState<AccountSummary | null>(null)
  const [emailTarget, setEmailTarget] = useState<AccountSummary | null>(null)
  const [editing, setEditing] = useState<AccountSummary | null>(null)
  const [markingLeft, setMarkingLeft] = useState<AccountSummary | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [pendingDeactivation, setPendingDeactivation] = useState<AccountSummary | null>(null)
  const [failedActivations, setFailedActivations] = useState<number | null>(null)
  const [showDeparted, setShowDeparted] = useState(false)

  const [draft, setDraft] = useState<Draft>({
    fullName: '',
    username: '',
    accountEmail: '',
    phone: '',
    role: 'employee',
    outletIds: !isOwner && session.outletId ? [session.outletId] : [],
    roleTitle: '',
    joinedOn: '',
  })

  const managedOutletIds = useMemo(
    () => new Set(sessionOutletsFor(session, 'franchise_admin')),
    [session],
  )
  const provisionableOutlets = useMemo(
    () => (isOwner ? outlets : outlets.filter((outlet) => managedOutletIds.has(outlet.id))),
    [isOwner, managedOutletIds, outlets],
  )
  // The allowed set arrives asynchronously with the outlet list. Derive the
  // usable selection instead of synchronising another state update from an
  // effect: one option is always the simple default, while stale choices from
  // an authority refresh are inert immediately.
  const effectiveOutletIds = useMemo(() => {
    if (provisionableOutlets.length === 1) return [provisionableOutlets[0]!.id]
    const allowed = new Set(provisionableOutlets.map((outlet) => outlet.id))
    return draft.outletIds.filter((outletId) => allowed.has(outletId))
  }, [draft.outletIds, provisionableOutlets])

  const refresh = useCallback(async () => {
    const list = await adapter.listAccounts()
    setAccounts(list)
  }, [adapter])

  useEffect(() => {
    let active = true
    void Promise.all([adapter.listAccounts(), outletsAdapter.listOutlets()])
      .then(([list, outletList]) => {
        if (!active) return
        setAccounts(list)
        setOutlets(outletList)
      })
      .catch(() => {
        if (active) setError('Could not load people. Try again in a moment.')
      })
    return () => {
      active = false
    }
  }, [adapter, outletsAdapter])

  // Asked separately and allowed to fail quietly: a burst of failed activations
  // is worth knowing about, and never worth costing somebody the screen they
  // came here to use.
  //
  // Not asked at all by anybody else. The database refuses every role but the
  // Super Admin, and it is what makes that true — but firing a request we know
  // will be refused would put a permanent 403 on every manager's screen load,
  // which is exactly the kind of standing noise that hides a real one later.
  useEffect(() => {
    if (!isOwner) return
    let active = true
    void adapter
      .failedActivations()
      .then((count) => {
        if (active) setFailedActivations(count)
      })
      .catch(() => {
        if (active) setFailedActivations(null)
      })
    return () => {
      active = false
    }
  }, [adapter, isOwner])

  const outletName = useCallback(
    (id: string | null) => outlets.find((outlet) => outlet.id === id)?.name ?? 'All outlets',
    [outlets],
  )

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
      await refresh()
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

  /** One act creates a working person: account, staff facts, issued code. */
  async function onProvision(event: FormEvent) {
    event.preventDefault()
    const outletIds = draft.role === 'super_admin' ? [] : effectiveOutletIds
    const isPerson = draft.role === 'employee' || draft.role === 'franchise_admin'

    if (!draft.fullName.trim()) {
      setError('This person needs a name — it is how they appear everywhere in the app.')
      return
    }
    const username = validateUsername(draft.username)
    if (username.error) {
      setError(usernameErrorMessage(username.error))
      return
    }
    if (draft.role === 'super_admin' && !draft.accountEmail.trim()) {
      setError('A Super Admin needs a private email.')
      return
    }

    if (draft.role !== 'super_admin' && outletIds.length === 0) {
      setError('Choose at least one outlet for this person.')
      return
    }

    setBusy(true)
    setError(null)
    try {
      const handover = await adapter.provision({
        fullName: draft.fullName,
        username: username.username,
        accountEmail: draft.role === 'super_admin' ? draft.accountEmail.trim().toLowerCase() : null,
        phone: draft.phone.trim() || null,
        role: draft.role,
        outletIds,
        roleTitle: isPerson ? draft.roleTitle.trim() || null : null,
        joinedOn: isPerson ? draft.joinedOn || null : null,
      })
      setIssued({ handover, name: draft.fullName })
      setFormOpen(false)
      setDraft((current) => ({
        ...current,
        fullName: '',
        username: '',
        accountEmail: '',
        phone: '',
        outletIds: provisionableOutlets.length === 1 ? [provisionableOutlets[0]!.id] : [],
        roleTitle: '',
        joinedOn: '',
      }))
      await refresh()
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

  const list = accounts ?? []
  // "Departed" is derived since multi-outlet-people: somebody has left the
  // business when they hold no live assignment anywhere. There is no column
  // saying so, because leaving ONE outlet is not leaving.
  const hasLeft = (row: AccountSummary) => liveAssignments(row.assignments).length === 0
  const departedCount = list.filter(hasLeft).length
  const visible = showDeparted ? list : list.filter((row) => !hasLeft(row))

  function lifecycleLabel(row: AccountSummary) {
    if (row.lifecycle.kind === 'deactivated') return 'Deactivated'
    if (hasLeft(row)) return 'Not assigned to an outlet'
    switch (row.lifecycle.kind) {
      case 'needs_setup':
        return 'Needs setup'
      case 'setup_link_issued':
        return 'Set-up link issued'
      case 'password_reset_issued':
        return 'Active · password reset issued'
      case 'active':
        return 'Active'
    }
  }

  function handoverActionLabel(row: AccountSummary) {
    switch (row.lifecycle.kind) {
      case 'needs_setup':
        return 'Set up account'
      case 'setup_link_issued':
        return 'Replace set-up link'
      case 'active':
        return 'Reset password'
      case 'password_reset_issued':
        return 'Replace reset link'
      case 'deactivated':
        return null
    }
  }

  const columns: DataTableColumn<AccountSummary>[] = [
    {
      id: 'name',
      header: 'Name',
      cell: (row) => (
        <span>
          <span className="font-semibold text-content">
            {row.fullName}
            {row.id === session.userId && <span className="text-content-muted"> (you)</span>}
          </span>
          {row.roleTitle && (
            <span className="block text-xs text-content-muted">{row.roleTitle}</span>
          )}
          {/* Read the username back so an admin can catch a typo. */}
          {row.username && (
            <span
              data-testid={`username-${row.id}`}
              className="block break-all text-xs text-content-muted"
            >
              {row.username}
            </span>
          )}
          {row.accountEmail && (
            <span
              data-testid={`account-email-${row.id}`}
              className="block break-all text-xs text-content-muted"
            >
              Email: {row.accountEmail}
            </span>
          )}
        </span>
      ),
    },
    {
      // One column rather than two, because a person no longer has "a role" and
      // "an outlet" — they have a set of places they work and what they do at
      // each. A manager sees only the assignments at outlets they manage; the
      // other outlet's row is the other outlet's data.
      id: 'assignments',
      header: 'Works at',
      cell: (row) => {
        const live = liveAssignments(row.assignments)
        if (live.length === 0) {
          return (
            <span data-testid={`unassigned-${row.id}`} className="text-content-muted">
              No outlet
            </span>
          )
        }
        return (
          <span className="flex flex-col gap-0.5" data-testid={`assignments-${row.id}`}>
            {live.map((assignment) => (
              <span key={assignment.id} className="text-sm">
                <span className="font-semibold text-content">
                  {outletName(assignment.outletId)}
                </span>
                <span className="text-content-muted"> · {ROLE_LABELS[assignment.role]}</span>
              </span>
            ))}
          </span>
        )
      },
    },
    {
      id: 'status',
      header: 'Status',
      cell: (row) => (
        <span>
          {lifecycleLabel(row) === 'Not assigned to an outlet' ? (
            <span data-testid={`departed-${row.id}`} className="font-semibold text-content-muted">
              Not assigned to any outlet
            </span>
          ) : row.lifecycle.kind === 'deactivated' ? (
            <span className="font-semibold text-danger">Deactivated</span>
          ) : (
            <span className="text-content-muted">{lifecycleLabel(row)}</span>
          )}
        </span>
      ),
    },
    {
      id: 'actions',
      header: 'Actions',
      align: 'right',
      cell: (row) =>
        row.id === session.userId ? (
          <span className="text-xs text-content-muted"></span>
        ) : (
          <span className="flex justify-end">
            <RowActionsMenu
              label={`Actions for ${row.fullName}`}
              actions={[
                {
                  label: 'Edit',
                  disabled: busy,
                  onSelect: () => setEditing(row),
                },
                {
                  label: 'Change username',
                  disabled: busy,

                  onSelect: () => setCorrecting(row),
                },
                ...(handoverActionLabel(row)
                  ? [
                      {
                        label: handoverActionLabel(row)!,
                        disabled: busy,
                        onSelect: () =>
                          void run(async () => {
                            const handover = await adapter.issueHandover(row.id)
                            setIssued({
                              handover,
                              name: row.fullName,
                              replacement:
                                row.lifecycle.kind === 'setup_link_issued' ||
                                row.lifecycle.kind === 'password_reset_issued',
                            })
                          }),
                      },
                    ]
                  : []),
                ...(isOwner &&
                liveAssignments(row.assignments).some(
                  (assignment) => assignment.role === 'super_admin',
                )
                  ? [
                      {
                        label: 'Change sign-in email',
                        disabled: busy,
                        onSelect: () => setEmailTarget(row),
                      },
                    ]
                  : []),
                row.lifecycle.kind !== 'deactivated'
                  ? {
                      label: 'Deactivate',
                      disabled: busy,
                      onSelect: () => setPendingDeactivation(row),
                    }
                  : {
                      label: 'Reactivate',
                      disabled: busy,
                      onSelect: () => void run(() => adapter.setActive(row.id, true)),
                    },
              ]}
            />
          </span>
        ),
    },
  ]

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="People"
        subtitle={
          isOwner
            ? 'Everyone, across all outlets — accounts and staff list in one place.'
            : 'This outlet’s people. Codes are handed over by you, never emailed.'
        }
        action={<AddButton label="Add person" onClick={() => setFormOpen(true)} />}
      />

      {/*
        Only failures are counted, and only across a quarter of an hour, so a
        normal morning of onboarding contributes nothing at all. A number here
        means somebody is trying codes — which is the only signal a targeted
        guessing attempt gives off (design D10).
      */}
      {failedActivations !== null && failedActivations >= FAILED_ACTIVATION_NOTICE && (
        <p
          role="status"
          data-testid="activation-pressure"
          className="mb-4 rounded-xl border border-border bg-surface-raised p-3 text-sm font-semibold text-warning"
        >
          {failedActivations} failed activation attempts in the last fifteen minutes. Codes are
          bounded and nothing is at immediate risk, but somebody is trying them.
        </p>
      )}

      {issued && (
        <AccountHandoverPanel
          handover={issued.handover}
          name={issued.name}
          replacement={issued.replacement}
          onDismiss={() => setIssued(null)}
        />
      )}

      {error && (
        <p
          role="alert"
          data-testid="accounts-error"
          className="mb-4 text-sm font-semibold text-danger"
        >
          {error}
        </p>
      )}

      {accounts === null ? (
        // The people list is a `DataTable`, so it waits behind rows.
        <LoadingTable
          label="the people here"
          rows={10}
          rowHeight="h-16"
          data-testid="accounts-loading"
        />
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={visible}
            rowKey={(row) => row.id}
            empty={
              <EmptyState
                icon={Users}
                title="Nobody yet. Add a person to put them on the staff list and give them access — you will get a code to pass on."
              />
            }
          />
          {departedCount > 0 && (
            <div className="mt-3">
              <Button
                variant="ghost"
                size="phone"
                data-testid="toggle-departed"
                onClick={() => setShowDeparted((current) => !current)}
              >
                {showDeparted
                  ? 'Hide people who have left'
                  : `Show people who have left (${departedCount})`}
              </Button>
            </div>
          )}
        </>
      )}

      <FormSheet
        open={formOpen}
        onClose={() => setFormOpen(false)}

        title="Add person"
        error={error}
        footer={
          <button
            type="submit"
            form="provision-account"
            disabled={busy}
            className={`${buttonVariants({ size: 'phone' })} w-full`}
          >
            {busy ? 'Creating…' : 'Create and issue a code'}
          </button>
        }
      >
        <form id="provision-account" onSubmit={onProvision} className="space-y-4" noValidate>
          <Field label="Full name" id="account-name">
            <Input
              id="account-name"
              required
              value={draft.fullName}
              onChange={(event) => setDraft({ ...draft, fullName: event.target.value })}
            />
          </Field>

          <Field label="Username" id="account-username">
            <Input
              id="account-username"
              name="username"
              type="text"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              required
              value={draft.username}
              onChange={(event) => setDraft({ ...draft, username: event.target.value })}
            />
            <p className="text-xs text-content-muted">
              3â€“30 lowercase letters, numbers, periods, or underscores. No @ sign.
            </p>
          </Field>

          <Field label="Phone (optional)" id="account-phone">
            <Input
              id="account-phone"
              type="tel"
              value={draft.phone}
              onChange={(event) => setDraft({ ...draft, phone: event.target.value })}
            />
          </Field>

          <Field label="Role" id="account-role">
            <Select
              id="account-role"
              value={draft.role}
              onChange={(event) => setDraft({ ...draft, role: event.target.value as AppRole })}
            >
              {assignableRoles.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </Select>
          </Field>

          {draft.role === 'super_admin' && (
            <Field label="Email" id="account-email">
              <Input
                id="account-email"
                name="account-email"
                type="email"
                autoComplete="off"

                inputMode="email"
                autoCapitalize="none"
                spellCheck={false}
                required
                value={draft.accountEmail}
                onChange={(event) => setDraft({ ...draft, accountEmail: event.target.value })}
              />
              <p className="text-xs text-content-muted">
                Private. This Super Admin can sign in with either their username or this email, and
                use it to recover access.
              </p>
            </Field>
          )}

          {draft.role !== 'super_admin' && (
            <Field
              label={provisionableOutlets.length > 1 ? 'Outlets' : 'Outlet'}
              id="account-outlet"
            >
              {provisionableOutlets.length === 0 ? (
                // The state a brand-new business is genuinely in. An empty
                // dropdown here reads as a bug; the actual problem is one
                // screen away (design D2).
                <p
                  data-testid="no-outlets"
                  className="rounded-lg border border-warning bg-surface-raised p-2 text-sm text-content"
                >
                  There are no outlets yet, and every account except an owner has to belong to one.
                  Create the outlet first — Outlets, then <em>Add outlet</em>.
                </p>
              ) : provisionableOutlets.length === 1 ? (
                <Select
                  id="account-outlet"
                  value={effectiveOutletIds[0] ?? ''}
                  disabled
                  onChange={() => undefined}
                >
                  <option value="">Choose an outlet</option>
                  {provisionableOutlets.map((outlet) => (
                    <option key={outlet.id} value={outlet.id}>
                      {outlet.name}
                    </option>
                  ))}
                </Select>
              ) : (
                <fieldset
                  aria-labelledby="account-outlet-label"
                  aria-describedby="account-outlets-help"
                >
                  <p id="account-outlets-help" className="mb-2 text-xs text-content-muted">
                    Choose one or more. They will have the same role at each.
                  </p>
                  <div
                    data-testid="account-outlet-options"
                    className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-border bg-surface p-1"
                  >
                    {provisionableOutlets.map((outlet) => {
                      const checked = effectiveOutletIds.includes(outlet.id)
                      return (
                        <label
                          key={outlet.id}
                          className="flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-sm font-semibold text-content hover:bg-surface-raised"
                        >
                          <input
                            type="checkbox"
                            className="size-5 shrink-0 accent-primary"
                            checked={checked}
                            onChange={(event) =>
                              setDraft({
                                ...draft,

                                outletIds: event.target.checked
                                  ? [...effectiveOutletIds, outlet.id]
                                  : effectiveOutletIds.filter((id) => id !== outlet.id),
                              })
                            }
                          />
                          {outlet.name}
                        </label>
                      )
                    })}
                  </div>
                </fieldset>
              )}
            </Field>
          )}

          {(draft.role === 'employee' || draft.role === 'franchise_admin') && (
            <>
              {/*
                No staff-code input: the database issues one from the outlet's
                prefix the moment the person is created. Nobody here has a
                staff ID to copy in.
              */}
              <Field label="Job title (optional)" id="account-role-title">
                <Input
                  id="account-role-title"
                  placeholder="Grill, counter, prep…"
                  value={draft.roleTitle}
                  onChange={(event) => setDraft({ ...draft, roleTitle: event.target.value })}
                />
              </Field>

              <Field label="Joined on (optional)" id="account-joined-on">
                <Input
                  id="account-joined-on"
                  type="date"
                  value={draft.joinedOn}
                  onChange={(event) => setDraft({ ...draft, joinedOn: event.target.value })}
                />
              </Field>
            </>
          )}
        </form>
      </FormSheet>

      {/* Keyed so opening it for a different person starts from their username. */}
      <ChangeUsernameSheet
        key={correcting?.id ?? 'none'}
        account={correcting}
        busy={busy}
        onClose={() => setCorrecting(null)}
        onSubmit={(username) => {
          const target = correcting
          if (!target) return
          void run(async () => {
            await adapter.changeUsername(target.id, username)
            setCorrecting(null)
          })
        }}
      />

      <AccountEmailSheet
        key={emailTarget?.id ?? 'no-email'}
        account={emailTarget}
        busy={busy}
        onClose={() => setEmailTarget(null)}
        onSubmit={(accountEmail) => {
          const target = emailTarget
          if (!target) return
          void run(async () => {
            await adapter.setAccountEmail(target.id, accountEmail)
            setEmailTarget(null)
          })
        }}
      />

      {/* Keyed so opening it for a different person starts from their facts. */}
      <EditPersonSheet
        key={editing?.id ?? 'no-edit'}
        account={editing}
        busy={busy}
        error={error}
        outlets={provisionableOutlets}
        isOwner={isOwner}
        onClose={() => setEditing(null)}
        onSubmit={(command) => {
          const target = editing
          if (!target) return
          void run(async () => {
            const result = await adapter.editAccount(command)
            if (result.replacementHandover) {
              setIssued({
                handover: result.replacementHandover,
                name: target.fullName,
                replacement: true,
              })
            }
            setEditing(null)
          })
        }}
        onMarkAsLeft={() => {
          if (editing) setMarkingLeft(editing)
        }}
      />

      <ConfirmDialog
        open={pendingDeactivation !== null}
        title="Deactivate this account?"
        consequence={
          pendingDeactivation
            ? `${pendingDeactivation.fullName} stops being able to read or write anything immediately, even if their app is already open. They stay on the staff list and today’s attendance — mark them as left if they no longer work here. You can reactivate them later.`
            : ''
        }
        confirmLabel="Deactivate"
        danger
        onClose={() => setPendingDeactivation(null)}
        onConfirm={() => {
          const target = pendingDeactivation
          setPendingDeactivation(null)
          if (target) void run(() => adapter.setActive(target.id, false))
        }}
      />

      <ConfirmDialog
        open={markingLeft !== null}
        title="Mark this person as left?"
        consequence={
          markingLeft
            ? `${markingLeft.fullName} will lose sign-in access and every current outlet assignment. Their completed work and assignment history stay on record. This cannot be done by ordinary Save.`
            : ''
        }
        confirmLabel="Mark as left"
        danger
        onClose={() => setMarkingLeft(null)}
        onConfirm={() => {
          const target = markingLeft
          if (!target) return
          setMarkingLeft(null)
          void run(async () => {
            await adapter.markAsLeft(target.id, target.stateFingerprint)

            setEditing(null)
          })
        }}
      />
    </div>
  )
}

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label id={`${id}-label`} htmlFor={id} className="block text-sm font-semibold">
        {label}
      </label>
      {children}
    </div>
  )
}

/**
 * Correcting the username an account signs in with.
 *
 * Its own sheet rather than a general "edit account", because this exists for
 * one situation — somebody typed it wrong and the person cannot get in — and a
 * form that also renamed and re-roled them would bury the thing being fixed.
 */
function ChangeUsernameSheet({
  account,
  busy,
  onClose,
  onSubmit,
}: {
  account: AccountSummary | null
  busy: boolean
  onClose: () => void
  onSubmit: (username: string) => void
}) {
  const [username, setUsername] = useState(account?.username ?? '')

  return (
    <FormSheet
      open={account !== null}
      onClose={onClose}
      title={account ? `Change username for ${account.fullName}` : 'Change username'}
      footer={
        <button
          type="submit"
          form="change-username"
          disabled={busy || validateUsername(username).error !== null}
          className={`${buttonVariants({ size: 'phone' })} w-full`}
        >
          {busy ? 'Saving…' : 'Save username'}
        </button>
      }
    >
      <form
        id="change-username"
        noValidate
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit(username)
        }}
      >
        <Field label="Username" id="correct-username">
          <Input
            id="correct-username"
            name="username"
            type="text"
            autoCapitalize="none"

            spellCheck={false}
            required
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </Field>
        <p className="rounded-lg border border-border bg-surface-raised p-2 text-xs text-content-muted">
          This is the username they sign in with. Any one-time code you have already given them
          still works — a code belongs to the account, not to the username — so there is no need to
          issue a new one.
        </p>
      </form>
    </FormSheet>
  )
}
/**
 * The staff facts, edited as this session under Row-Level Security. What is
 * left of them since multi-outlet-people: who the person is and what they do.
 * Where they work is an assignment, with its own action and its own authority.
 */
function AccountEmailSheet({
  account,
  busy,
  onClose,
  onSubmit,
}: {
  account: AccountSummary | null
  busy: boolean
  onClose: () => void
  onSubmit: (accountEmail: string) => void
}) {
  const [accountEmail, setAccountEmail] = useState(account?.accountEmail ?? '')

  return (
    <FormSheet
      open={account !== null}
      onClose={onClose}
      title={account ? `Email for ${account.fullName}` : 'Email'}
      footer={
        <button
          type="submit"
          form="change-account-email"
          disabled={busy || accountEmail.trim() === ''}
          className={`${buttonVariants({ size: 'phone' })} w-full`}
        >
          {busy ? 'Saving…' : 'Save email'}
        </button>
      }
    >
      <form
        id="change-account-email"
        className="space-y-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit(accountEmail)
        }}
      >
        <Field label="Email" id="correct-account-email">
          <Input
            id="correct-account-email"
            name="account-email"
            type="email"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={accountEmail}
            onChange={(event) => setAccountEmail(event.target.value)}
          />
        </Field>
        <p className="rounded-lg border border-border bg-surface-raised p-2 text-xs text-content-muted">
          This private email is an alternate sign-in for the same account and keeps the account
          ready for future security features.
        </p>
      </form>
    </FormSheet>
  )
}

function EditPersonSheet({
  account,
  busy,
  error,
  outlets,
  isOwner,
  onClose,
  onSubmit,
  onMarkAsLeft,
}: {
  account: AccountSummary | null
  busy: boolean
  error: string | null
  outlets: Tables<'outlets'>[]
  isOwner: boolean
  onClose: () => void
  onSubmit: (command: {
    profileId: string
    expectedStateFingerprint: string
    fullName: string
    phone: string | null
    roleTitle: string | null
    accountEmail: string | null
    assignments: Array<{
      assignmentId: string | null
      outletId: string | null
      role: AppRole
      startedOn: string
    }>
  }) => void
  onMarkAsLeft: () => void
}) {
  const [fullName, setFullName] = useState(account?.fullName ?? '')
  const [phone, setPhone] = useState(account?.phone ?? '')
  const [roleTitle, setRoleTitle] = useState(account?.roleTitle ?? '')
  const live = account ? liveAssignments(account.assignments) : []
  const ownerAssignment = live.find((assignment) => assignment.role === 'super_admin') ?? null
  const ordinaryAssignments = live.filter(
    (assignment): assignment is OrdinaryAssignment =>
      assignment.role !== 'super_admin' && assignment.outletId !== null,
  )
  const [assignments, setAssignments] = useState<AssignmentDraft[]>(() =>
    ordinaryAssignments.map((assignment) => ({
      assignmentId: assignment.id,
      outletId: assignment.outletId,
      role: assignment.role,
      startedOn: assignment.startedOn,
    })),
  )
  const [expanded, setExpanded] = useState(
    ordinaryAssignments.length !== 1 ||
      new Set(ordinaryAssignments.map((assignment) => assignment.role)).size > 1 ||
      ownerAssignment !== null,
  )
  const [ownerAccess, setOwnerAccess] = useState(ownerAssignment !== null)
  const [ownerAccessConfirmed, setOwnerAccessConfirmed] = useState(false)
  const [accountEmail, setAccountEmail] = useState(account?.accountEmail ?? '')
  const editableRoles = isOwner ? ORDINARY_ROLES : STAFF_ROLES
  const selectedOutletIds = new Set(assignments.map((assignment) => assignment.outletId))

  const addableOutlets = outlets.filter((outlet) => !selectedOutletIds.has(outlet.id))
  const ownerAccessChanged = ownerAccess !== (ownerAssignment !== null)
  const intendedAssignments = [
    ...assignments.map((assignment) => ({ ...assignment, outletId: assignment.outletId || null })),
    ...(ownerAccess
      ? [
          {
            assignmentId: ownerAssignment?.id ?? null,
            outletId: null,
            role: 'super_admin' as const,
            startedOn: ownerAssignment?.startedOn ?? todayInIndia(),
          },
        ]
      : []),
  ]
  const hasValidAssignments =
    intendedAssignments.length > 0 &&
    assignments.every((assignment) => assignment.outletId !== '') &&
    (!ownerAccess || !ownerAccessChanged || (ownerAccessConfirmed && accountEmail.trim() !== ''))

  function updateAssignment(index: number, patch: Partial<AssignmentDraft>) {
    setAssignments((current) =>
      current.map((assignment, currentIndex) =>
        currentIndex === index ? { ...assignment, ...patch } : assignment,
      ),
    )
  }

  function addAssignment() {
    const outlet = addableOutlets[0]
    if (!outlet) return
    setAssignments((current) => [
      ...current,
      {
        assignmentId: null,
        outletId: outlet.id,
        role: 'employee',
        startedOn: todayInIndia(),
      },
    ])
    setExpanded(true)
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!account || !fullName.trim() || !hasValidAssignments) return
    onSubmit({
      profileId: account.id,
      expectedStateFingerprint: account.stateFingerprint,
      fullName: fullName.trim(),
      phone: phone.trim() || null,
      roleTitle: roleTitle.trim() || null,
      // A private email survives owner removal. Its own credential action can
      // correct it; ordinary placement editing never silently blanks it.
      accountEmail: accountEmail.trim().toLowerCase() || account.accountEmail,
      assignments: intendedAssignments,
    })
  }

  return (
    <FormSheet
      open={account !== null}
      onClose={onClose}
      title={account ? `Edit ${account.fullName}` : 'Edit person'}
      error={error}
      footer={
        <button
          type="submit"

          form="edit-person"
          disabled={busy || !fullName.trim() || !hasValidAssignments}
          className={`${buttonVariants({ size: 'phone' })} w-full`}
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      }
    >
      <form id="edit-person" onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Full name" id="edit-name">
          <Input
            id="edit-name"
            required
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
          />
        </Field>

        <Field label="Phone (optional)" id="edit-phone">
          <Input
            id="edit-phone"
            type="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
          />
        </Field>

        <Field label="Job title (optional)" id="edit-role-title">
          <Input
            id="edit-role-title"
            placeholder="Grill, counter, prep…"
            value={roleTitle}
            onChange={(event) => setRoleTitle(event.target.value)}
          />
        </Field>

        {!expanded && assignments[0] && (
          <section aria-label="Primary outlet assignment" className="space-y-4">
            <Field label="Outlet" id="edit-outlet">
              <Select
                id="edit-outlet"
                value={assignments[0].outletId}
                onChange={(event) => updateAssignment(0, { outletId: event.target.value })}
              >
                {outlets.map((outlet) => (
                  <option key={outlet.id} value={outlet.id}>
                    {outlet.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Access role" id="edit-role">
              <Select
                id="edit-role"
                value={assignments[0].role}
                onChange={(event) =>
                  updateAssignment(0, { role: event.target.value as AssignmentDraft['role'] })
                }
              >
                {editableRoles.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </option>
                ))}
              </Select>
            </Field>
          </section>
        )}

        {!expanded && (
          <Button
            type="button"
            variant="ghost"
            size="phone"
            aria-expanded={false}
            aria-controls="multiple-outlet-assignments"
            onClick={() => setExpanded(true)}
          >
            Works at multiple outlets
          </Button>
        )}

        {expanded && (
          <section
            id="multiple-outlet-assignments"
            aria-label="Outlet assignments"
            className="space-y-3"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-content">Works at multiple outlets</h3>
                <p className="text-xs text-content-muted">
                  One role at each outlet. Change a row to promote, transfer, or move someone.
                </p>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="phone"
                disabled={addableOutlets.length === 0}
                onClick={addAssignment}
              >
                Add outlet
              </Button>
            </div>

            {assignments.length === 0 ? (
              <p
                data-testid="edit-no-assignments"
                className="rounded-lg border border-warning bg-surface-raised p-3 text-sm text-content"
              >
                Add an outlet before saving. Ordinary Edit cannot remove every assignment.
              </p>
            ) : (
              assignments.map((assignment, index) => {
                const otherOutletIds = new Set(
                  assignments
                    .filter((_, assignmentIndex) => assignmentIndex !== index)
                    .map((current) => current.outletId),
                )
                const selectableOutlets = outlets.filter(
                  (outlet) => outlet.id === assignment.outletId || !otherOutletIds.has(outlet.id),
                )
                return (
                  <fieldset
                    key={assignment.assignmentId ?? `new-${index}`}
                    className="grid gap-3 rounded-xl border border-border bg-surface-raised p-3 sm:grid-cols-2"
                  >
                    <legend className="px-1 text-sm font-semibold text-content">
                      Outlet {index + 1}
                    </legend>
                    <Field label={`Outlet ${index + 1}`} id={`edit-outlet-${index}`}>
                      <Select
                        id={`edit-outlet-${index}`}
                        value={assignment.outletId}
                        onChange={(event) =>
                          updateAssignment(index, { outletId: event.target.value })
                        }
                      >
                        {selectableOutlets.map((outlet) => (
                          <option key={outlet.id} value={outlet.id}>
                            {outlet.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label={`Access role at outlet ${index + 1}`} id={`edit-role-${index}`}>
                      <Select
                        id={`edit-role-${index}`}
                        value={assignment.role}
                        onChange={(event) =>
                          updateAssignment(index, {
                            role: event.target.value as AssignmentDraft['role'],
                          })
                        }
                      >
                        {editableRoles.map((role) => (
                          <option key={role} value={role}>
                            {ROLE_LABELS[role]}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field
                      label={`Started on at outlet ${index + 1}`}
                      id={`edit-started-on-${index}`}
                    >
                      <Input
                        id={`edit-started-on-${index}`}
                        type="date"
                        value={assignment.startedOn}
                        onChange={(event) =>
                          updateAssignment(index, { startedOn: event.target.value })
                        }
                      />
                    </Field>
                    <div className="flex items-end">
                      <Button
                        type="button"
                        variant="ghost"
                        size="phone"
                        onClick={() =>
                          setAssignments((current) =>
                            current.filter((_, assignmentIndex) => assignmentIndex !== index),
                          )
                        }
                      >
                        Remove outlet
                      </Button>
                    </div>
                  </fieldset>
                )
              })
            )}
          </section>
        )}

        {isOwner && (
          <section
            aria-label="Owner access"
            className="space-y-3 rounded-xl border border-border bg-surface-raised p-3"
          >
            {ownerAccess ? (
              <>
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-content">Owner access</h3>
                  <p className="text-xs text-content-muted">
                    Owners can work across every outlet. This is separate from outlet roles.
                  </p>
                </div>
                <Field label="Private sign-in email" id="edit-owner-email">
                  <Input
                    id="edit-owner-email"
                    type="email"
                    inputMode="email"
                    autoCapitalize="none"

                    value={accountEmail}
                    onChange={(event) => setAccountEmail(event.target.value)}
                  />
                </Field>
                {ownerAccessChanged && (
                  <label className="flex items-start gap-2 text-sm text-content">
                    <input
                      type="checkbox"
                      className="mt-1 size-4 accent-primary"
                      checked={ownerAccessConfirmed}
                      onChange={(event) => setOwnerAccessConfirmed(event.target.checked)}
                    />
                    I understand this grants owner access across all outlets.
                  </label>
                )}
                {ownerAssignment && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="phone"
                    onClick={() => {
                      setOwnerAccess(false)
                      setOwnerAccessConfirmed(false)
                    }}
                  >
                    Remove owner access
                  </Button>
                )}
              </>
            ) : (
              <Button
                type="button"
                variant="secondary"
                size="phone"
                onClick={() => setOwnerAccess(true)}
              >
                Grant owner access
              </Button>
            )}
          </section>
        )}

        {account?.lifecycle.kind !== 'deactivated' && (
          <section className="border-t border-border pt-4">
            <h3 className="text-sm font-semibold text-danger">Leaving the business</h3>
            <p className="mt-1 text-xs text-content-muted">
              This ends every current assignment and sign-in access. It is never the result of
              ordinary Save.
            </p>
            <Button
              type="button"
              variant="danger"
              size="phone"
              className="mt-3"
              onClick={onMarkAsLeft}
            >
              Mark as left
            </Button>
          </section>
        )}
      </form>
    </FormSheet>
  )
}
