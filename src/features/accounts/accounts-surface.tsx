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
import { QrCode } from '@/components/ui/qr-code'
import { Select } from '@/components/ui/select'
import { useAdapters, type Tables } from '@/data-access'
import {
  DataActionError,
  FAILED_ACTIVATION_NOTICE,
  liveAssignments,
  type AccountSummary,
  type AppRole,
  type IssuedCode,
} from '@/data-access/adapters'
import { activationLink } from '@/lib/activation-link'
import { useSession } from '@/session/context'
import { holdsRole, ROLE_LABELS, sessionOutletsFor } from '@/session/session'
import { validateUsername, usernameErrorMessage } from '../../../shared/username'

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
  const [issued, setIssued] = useState<(IssuedCode & { name: string; inactive?: boolean }) | null>(
    null,
  )
  const [correcting, setCorrecting] = useState<AccountSummary | null>(null)
  const [emailTarget, setEmailTarget] = useState<AccountSummary | null>(null)
  const [editing, setEditing] = useState<AccountSummary | null>(null)
  const [departing, setDeparting] = useState<AccountSummary | null>(null)
  const [assigning, setAssigning] = useState<AccountSummary | null>(null)
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
      const code = await adapter.provision({
        fullName: draft.fullName,
        username: username.username,
        accountEmail: draft.role === 'super_admin' ? draft.accountEmail.trim().toLowerCase() : null,
        phone: draft.phone.trim() || null,
        role: draft.role,
        outletIds,
        roleTitle: isPerson ? draft.roleTitle.trim() || null : null,
        joinedOn: isPerson ? draft.joinedOn || null : null,
      })
      setIssued({ ...code, name: draft.fullName })
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
          {hasLeft(row) ? (
            <span data-testid={`departed-${row.id}`} className="font-semibold text-content-muted">
              Not assigned to any outlet
            </span>
          ) : !row.isActive ? (
            <span className="font-semibold text-danger">Deactivated</span>
          ) : row.invite ? (
            <span className="text-content-muted">Awaiting activation</span>
          ) : (
            <span className="text-content-muted">Active</span>
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
                  label: 'New code',
                  disabled: busy,
                  onSelect: () =>
                    void run(async () => {
                      const code = await adapter.reissue(row.id)
                      setIssued({ ...code, name: row.fullName })
                    }),
                },
                {
                  label: 'Change username',
                  disabled: busy,
                  onSelect: () => setCorrecting(row),
                },
                ...(isOwner &&
                liveAssignments(row.assignments).some(
                  (assignment) => assignment.role === 'super_admin',
                )
                  ? [
                      {
                        label: 'Change email',
                        disabled: busy,
                        onSelect: () => setEmailTarget(row),
                      },
                    ]
                  : []),
                {
                  label: 'Edit person',
                  disabled: busy,
                  onSelect: () => setEditing(row),
                },
                {
                  label: 'Assign to an outlet',
                  disabled: busy,
                  onSelect: () => setAssigning(row),
                },
                ...(liveAssignments(row.assignments).length > 0
                  ? [
                      {
                        label: 'End an assignment',
                        disabled: busy,
                        onSelect: () => setDeparting(row),
                      },
                    ]
                  : []),
                row.isActive
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

      {issued && <IssuedCodePanel issued={issued} onDismiss={() => setIssued(null)} />}

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
        <p className="text-sm text-content-muted">Loading…</p>
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
              3–30 lowercase letters, numbers, periods, or underscores. No @ sign.
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
        onClose={() => setEditing(null)}
        onSubmit={(patch) => {
          const target = editing
          if (!target) return
          void run(async () => {
            await adapter.updateStaffFacts(target.id, patch)
            setEditing(null)
          })
        }}
      />

      {/* Keyed so the choice and the deactivation offer reset per person. */}
      <EndAssignmentSheet
        key={departing?.id ?? 'no-departure'}
        account={departing}
        busy={busy}
        outletName={outletName}
        onClose={() => setDeparting(null)}
        onSubmit={(assignmentId, alsoDeactivate) => {
          const target = departing
          if (!target) return
          void run(async () => {
            const replacement = await adapter.endAssignment(assignmentId)
            setDeparting(null)
            if (replacement) {
              setIssued({
                ...replacement,
                name: target.fullName,
                inactive: false,
              })
            }
            // Only offered, and only meaningful, when this was their last
            // place: cutting sign-in for somebody who still works at the other
            // outlet would be the panic button, not a departure.
            if (alsoDeactivate && target.isActive) {
              await adapter.setActive(target.id, false)
              if (replacement) {
                setIssued({
                  ...replacement,
                  name: target.fullName,
                  inactive: true,
                })
              }
            }
          })
        }}
      />

      <AssignSheet
        key={assigning?.id ?? 'no-assignment'}
        account={assigning}
        busy={busy}
        outlets={outlets}
        isOwner={isOwner}
        onClose={() => setAssigning(null)}
        onSubmit={(role, outletId) => {
          const target = assigning
          if (!target) return
          void run(async () => {
            const replacement = await adapter.grantAssignment({
              personId: target.id,
              role,
              outletId,
            })
            setAssigning(null)
            if (replacement) {
              setIssued({
                ...replacement,
                name: target.fullName,
              })
            }
          })
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
  onClose,
  onSubmit,
}: {
  account: AccountSummary | null
  busy: boolean
  onClose: () => void
  onSubmit: (patch: { fullName?: string; roleTitle?: string | null }) => void
}) {
  const [fullName, setFullName] = useState(account?.fullName ?? '')
  const [roleTitle, setRoleTitle] = useState(account?.roleTitle ?? '')

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!account || !fullName.trim()) return
    // What is left of a person's editable facts once placement moved to its
    // own relation: who they are, and what they do. Where they work is an
    // assignment, with its own action and its own authority.
    onSubmit({ fullName: fullName.trim(), roleTitle: roleTitle.trim() || null })
  }

  return (
    <FormSheet
      open={account !== null}
      onClose={onClose}
      title={account ? `Edit ${account.fullName}` : 'Edit person'}
      footer={
        <button
          type="submit"
          form="edit-person"
          disabled={busy || !fullName.trim()}
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

        <Field label="Job title (optional)" id="edit-role-title">
          <Input
            id="edit-role-title"
            placeholder="Grill, counter, prep…"
            value={roleTitle}
            onChange={(event) => setRoleTitle(event.target.value)}
          />
        </Field>
      </form>
    </FormSheet>
  )
}

/**
 * Ending one assignment.
 *
 * Which one has to be asked now, because a person may hold several and
 * "leaving" one outlet is not leaving the business — that distinction is the
 * whole of per-outlet departure. Their sign-in is only offered up when this is
 * their LAST place: cutting access for somebody who still works at the other
 * outlet would be the panic button wearing a departure's clothes, and the two
 * are independent by design.
 */
function EndAssignmentSheet({
  account,
  busy,
  outletName,
  onClose,
  onSubmit,
}: {
  account: AccountSummary | null
  busy: boolean
  outletName: (id: string | null) => string
  onClose: () => void
  onSubmit: (assignmentId: string, alsoDeactivate: boolean) => void
}) {
  const live = account ? liveAssignments(account.assignments) : []
  const [assignmentId, setAssignmentId] = useState(live[0]?.id ?? '')
  const [alsoDeactivate, setAlsoDeactivate] = useState(true)

  const isLast = live.length === 1

  function submit(event: FormEvent) {
    event.preventDefault()
    if (assignmentId) onSubmit(assignmentId, isLast && alsoDeactivate)
  }

  return (
    <FormSheet
      open={account !== null}
      onClose={onClose}
      title={account ? `${account.fullName} is leaving` : 'End an assignment'}
      footer={
        <button
          type="submit"
          form="end-assignment"
          disabled={busy || !assignmentId}
          className={`${buttonVariants({ size: 'phone' })} w-full`}
        >
          {busy ? 'Saving…' : 'End this assignment'}
        </button>
      }
    >
      <form id="end-assignment" onSubmit={submit} className="space-y-4" noValidate>
        <p className="text-sm text-content-muted">
          They leave that outlet’s staff list and its new attendance days. Every day they worked
          stays on the record — nothing is deleted, and they can be assigned there again later.
        </p>

        {account?.invite && (
          <p data-testid="end-reissues-code" className="text-sm font-semibold text-content">
            Their current activation link will stop working. Saving replaces it and shows you the
            new link straight away.
          </p>
        )}

        <Field label="Which outlet" id="end-assignment-outlet">
          <Select
            id="end-assignment-outlet"
            required
            value={assignmentId}
            onChange={(event) => setAssignmentId(event.target.value)}
          >
            {live.map((assignment) => (
              <option key={assignment.id} value={assignment.id}>
                {outletName(assignment.outletId)} · {ROLE_LABELS[assignment.role]}
              </option>
            ))}
          </Select>
        </Field>

        {isLast && account?.isActive && (
          <label className="flex items-center gap-2 text-sm text-content">
            <input
              type="checkbox"
              checked={alsoDeactivate}
              onChange={(event) => setAlsoDeactivate(event.target.checked)}
            />
            This is their last outlet — also deactivate their sign-in (recommended)
          </label>
        )}
        {isLast && account?.isActive && account.invite && (
          <p className="text-xs text-content-muted">
            If you also deactivate the account, the new link will work only after you reactivate it.
          </p>
        )}

        {!isLast && (
          <p data-testid="still-works-elsewhere" className="text-sm text-content-muted">
            They still work at {live.length - 1} other outlet
            {live.length - 1 === 1 ? '' : 's'}, so their sign-in is left alone.
          </p>
        )}
      </form>
    </FormSheet>
  )
}

/**
 * Placing somebody at an outlet.
 *
 * Only what the caller may actually grant is offered — a manager sees their
 * own outlets and the two roles below their own — but the offer is a
 * convenience, not the boundary: the database refuses anything else whatever
 * this form sends.
 */
function AssignSheet({
  account,
  busy,
  outlets,
  isOwner,
  onClose,
  onSubmit,
}: {
  account: AccountSummary | null
  busy: boolean
  outlets: Tables<'outlets'>[]
  isOwner: boolean
  onClose: () => void
  onSubmit: (role: AppRole, outletId: string | null) => void
}) {
  const takenOutlets = new Set(
    (account ? liveAssignments(account.assignments) : []).map((a) => a.outletId),
  )
  const available = outlets.filter((outlet) => !takenOutlets.has(outlet.id))

  const roles: AppRole[] = isOwner
    ? ['franchise_admin', 'biller', 'employee']
    : ['biller', 'employee']

  const [role, setRole] = useState<AppRole>('employee')
  const [outletId, setOutletId] = useState(available[0]?.id ?? '')

  function submit(event: FormEvent) {
    event.preventDefault()
    if (outletId) onSubmit(role, outletId)
  }

  return (
    <FormSheet
      open={account !== null}
      onClose={onClose}
      title={account ? `Assign ${account.fullName}` : 'Assign to an outlet'}
      footer={
        <button
          type="submit"
          form="assign-person"
          disabled={busy || !outletId}
          className={`${buttonVariants({ size: 'phone' })} w-full`}
        >
          {busy ? 'Saving…' : 'Assign'}
        </button>
      }
    >
      <form id="assign-person" onSubmit={submit} className="space-y-4" noValidate>
        {available.length === 0 ? (
          <p data-testid="nowhere-left" className="text-sm text-content-muted">
            They already work at every outlet you manage. Nothing to add.
          </p>
        ) : (
          <>
            <p className="text-sm text-content-muted">
              They keep everything they already have. One login, however many outlets — nothing to
              switch and nothing for them to learn.
            </p>

            {account?.invite && (
              <p data-testid="assign-reissues-code" className="text-sm font-semibold text-content">
                Their current activation link will stop working. Saving replaces it and shows you
                the new link straight away.
              </p>
            )}

            <Field label="Outlet" id="assign-outlet">
              <Select
                id="assign-outlet"
                required
                value={outletId}
                onChange={(event) => setOutletId(event.target.value)}
              >
                {available.map((outlet) => (
                  <option key={outlet.id} value={outlet.id}>
                    {outlet.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Role there" id="assign-role">
              <Select
                id="assign-role"
                required
                value={role}
                onChange={(event) => setRole(event.target.value as AppRole)}
              >
                {roles.map((option) => (
                  <option key={option} value={option}>
                    {ROLE_LABELS[option]}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        )}
      </form>
    </FormSheet>
  )
}

/** A copy button that says it worked, because a clipboard write is invisible. */
function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      size="phone"
      onClick={() => {
        void navigator.clipboard
          ?.writeText(text)
          .then(() => setCopied(true))
          .catch(() => setCopied(false))
      }}
    >
      {copied ? 'Copied' : label}
    </Button>
  )
}

/**
 * The handover, once. There is nowhere to look it up afterwards — only a hash
 * is stored, and that column is unreadable by every client.
 *
 * **The link is the only handover offered.** The raw code used to sit beside it
 * for reading out over a call, and that turned one action into a choice between
 * three: it made the panel wordy, and it invited a handover that skips the tap
 * this whole flow exists to provide. Anyone who genuinely must dictate one can
 * still read the code out of the URL, so nothing is actually lost by not
 * printing it twice.
 *
 * The username is the last cheap moment to catch a typo before the link is
 * handed over.
 */
function IssuedCodePanel({
  issued,
  onDismiss,
}: {
  issued: IssuedCode & { name: string; inactive?: boolean }
  onDismiss: () => void
}) {
  const link = activationLink(issued.code)

  return (
    <div
      data-testid="issued-code"
      className="mb-4 rounded-xl border border-border bg-surface-raised p-4"
    >
      <p className="text-sm font-semibold text-content">Activation link for {issued.name}</p>
      <p data-testid="issued-code-username" className="break-all text-sm text-content-muted">
        Username: <strong className="text-content">{issued.username}</strong> — check this.
      </p>
      {issued.inactive && (
        <p
          data-testid="issued-code-inactive"
          className="mt-2 rounded-lg border border-warning bg-surface p-2 text-sm font-semibold text-content"
        >
          This account is deactivated. Reactivate it before this link is used.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-4">
        <QrCode
          value={link}
          title={`Activation link for ${issued.name}`}
          className="h-36 w-36 shrink-0 rounded-lg"
        />
        <div className="min-w-0 flex-1 space-y-3">
          <p
            data-testid="issued-code-link"
            className="rounded-lg border border-border bg-surface p-2 font-mono text-xs break-all text-content"
          >
            {link}
          </p>
          <div className="flex flex-wrap gap-2">
            <CopyButton text={link} label="Copy link" />
            <Button variant="ghost" size="phone" onClick={onDismiss}>
              Done
            </Button>
          </div>
        </div>
      </div>

      <p className="mt-3 text-xs text-content-muted">
        Shown once · works once · expires{' '}
        {new Date(issued.expiresAt).toLocaleDateString('en-IN', { dateStyle: 'medium' })}
      </p>
    </div>
  )
}
