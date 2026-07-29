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
  isOutletPerson,
  isPlaceholderAddress,
  type AccountSummary,
  type AppRole,
  type IssuedCode,
} from '@/data-access/adapters'
import { activationLink } from '@/lib/activation-link'
import { useSession } from '@/session/context'
import { ROLE_LABELS } from '@/session/session'

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
  email: string
  phone: string
  role: AppRole
  outletId: string
  roleTitle: string
  joinedOn: string
}

export function AccountsSurface() {
  const session = useSession()
  const { accounts: adapter, outlets: outletsAdapter } = useAdapters()

  const isOwner = session.role === 'super_admin'
  const assignableRoles = useMemo<AppRole[]>(
    () => (isOwner ? ROLE_ORDER : ['biller', 'employee']),
    [isOwner],
  )

  const [accounts, setAccounts] = useState<AccountSummary[] | null>(null)
  const [outlets, setOutlets] = useState<Tables<'outlets'>[]>([])
  const [error, setError] = useState<string | null>(null)
  const [issued, setIssued] = useState<
    (IssuedCode & { name: string; email: string | null }) | null
  >(null)
  const [correcting, setCorrecting] = useState<AccountSummary | null>(null)
  const [editing, setEditing] = useState<AccountSummary | null>(null)
  const [departing, setDeparting] = useState<AccountSummary | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [pendingDeactivation, setPendingDeactivation] = useState<AccountSummary | null>(null)
  const [failedActivations, setFailedActivations] = useState<number | null>(null)
  const [showDeparted, setShowDeparted] = useState(false)

  const [draft, setDraft] = useState<Draft>({
    fullName: '',
    email: '',
    phone: '',
    role: 'employee',
    outletId: session.outletId ?? '',
    roleTitle: '',
    joinedOn: '',
  })

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
    const outletId = draft.role === 'super_admin' ? null : draft.outletId || null
    const isPerson = draft.role === 'employee' || draft.role === 'franchise_admin'

    // Both fields carry attributes that look like they validate and do not:
    // this form has `noValidate`, which makes `required` and `type="email"`
    // inert on submit. A blank name provisions an account that is nobody, and
    // a blank address provisions one nobody can sign in to.
    if (!draft.fullName.trim()) {
      setError('This person needs a name — it is how they appear everywhere in the app.')
      return
    }
    if (!draft.email.trim()) {
      setError('An email address is needed — it is how this person signs in.')
      return
    }

    setBusy(true)
    setError(null)
    try {
      const code = await adapter.provision({
        fullName: draft.fullName,
        email: draft.email,
        phone: draft.phone.trim() || null,
        role: draft.role,
        outletId,
        roleTitle: isPerson ? draft.roleTitle.trim() || null : null,
        joinedOn: isPerson ? draft.joinedOn || null : null,
      })
      setIssued({ ...code, name: draft.fullName, email: draft.email.trim().toLowerCase() })
      setFormOpen(false)
      setDraft((current) => ({
        ...current,
        fullName: '',
        email: '',
        phone: '',
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
  const departedCount = list.filter((row) => row.leftOn !== null).length
  const visible = showDeparted ? list : list.filter((row) => row.leftOn === null)

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
          {(row.staffCode || row.roleTitle) && (
            <span className="block text-xs text-content-muted">
              {row.staffCode}
              {row.staffCode && row.roleTitle ? ' · ' : ''}
              {row.roleTitle}
            </span>
          )}
          {/*
            Read back on the list because it is otherwise typed once and never
            seen again — and a typo produces an account that refuses the code,
            refuses sign-in, and says the same uninformative thing either way.
          */}
          {row.email &&
            (isPlaceholderAddress(row.email) ? (
              <span
                data-testid={`placeholder-${row.id}`}
                className="block break-all text-xs font-semibold text-warning"
              >
                Placeholder address — set a real one before issuing a code.
              </span>
            ) : (
              <span
                data-testid={`email-${row.id}`}
                className="block break-all text-xs text-content-muted"
              >
                {row.email}
              </span>
            ))}
        </span>
      ),
    },
    { id: 'role', header: 'Role', cell: (row) => ROLE_LABELS[row.role] },
    ...(isOwner
      ? [
          {
            id: 'outlet',
            header: 'Outlet',
            cell: (row: AccountSummary) => outletName(row.outletId),
          },
        ]
      : []),
    {
      id: 'status',
      header: 'Status',
      cell: (row) => (
        <span>
          {row.leftOn !== null ? (
            <span data-testid={`departed-${row.id}`} className="font-semibold text-content-muted">
              Left {new Date(row.leftOn).toLocaleDateString('en-IN', { dateStyle: 'medium' })}
            </span>
          ) : !row.isActive ? (
            <span className="font-semibold text-danger">Deactivated</span>
          ) : isPlaceholderAddress(row.email) ? (
            <span className="text-warning">Needs an address</span>
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
                  // A code for a placeholder address would show the person an
                  // address that is not theirs at activation. Fix it first.
                  disabled: busy || isPlaceholderAddress(row.email),
                  onSelect: () =>
                    void run(async () => {
                      const code = await adapter.reissue(row.id)
                      setIssued({ ...code, name: row.fullName, email: row.email })
                    }),
                },
                {
                  label: 'Change email',
                  disabled: busy,
                  onSelect: () => setCorrecting(row),
                },
                {
                  label: 'Edit person',
                  disabled: busy,
                  onSelect: () => setEditing(row),
                },
                ...(isOutletPerson(row)
                  ? [
                      row.leftOn === null
                        ? {
                            label: 'Mark as left',
                            disabled: busy,
                            onSelect: () => setDeparting(row),
                          }
                        : {
                            label: 'Mark as returned',
                            disabled: busy,
                            onSelect: () =>
                              void run(async () => {
                                await adapter.updateStaffFacts(row.id, { leftOn: null })
                              }),
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

          <Field label="Email" id="account-email">
            <Input
              id="account-email"
              type="email"
              autoCapitalize="none"
              spellCheck={false}
              required
              value={draft.email}
              onChange={(event) => setDraft({ ...draft, email: event.target.value })}
            />
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

          {draft.role !== 'super_admin' && (
            <Field label="Outlet" id="account-outlet">
              {outlets.length === 0 ? (
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
              ) : (
                <Select
                  id="account-outlet"
                  value={draft.outletId}
                  disabled={!isOwner}
                  onChange={(event) => setDraft({ ...draft, outletId: event.target.value })}
                >
                  <option value="">Choose an outlet</option>
                  {(isOwner
                    ? outlets
                    : outlets.filter((outlet) => outlet.id === session.outletId)
                  ).map((outlet) => (
                    <option key={outlet.id} value={outlet.id}>
                      {outlet.name}
                    </option>
                  ))}
                </Select>
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

      {/* Keyed so opening it for a different person starts from their address. */}
      <ChangeEmailSheet
        key={correcting?.id ?? 'none'}
        account={correcting}
        busy={busy}
        onClose={() => setCorrecting(null)}
        onSubmit={(email) => {
          const target = correcting
          if (!target) return
          void run(async () => {
            await adapter.changeEmail(target.id, email)
            setCorrecting(null)
          })
        }}
      />

      {/* Keyed so opening it for a different person starts from their facts. */}
      <EditPersonSheet
        key={editing?.id ?? 'no-edit'}
        account={editing}
        isOwner={isOwner}
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

      {/* Keyed so the date and the deactivation offer reset per person. */}
      <MarkLeftSheet
        key={departing?.id ?? 'no-departure'}
        account={departing}
        busy={busy}
        onClose={() => setDeparting(null)}
        onSubmit={(leftOn, alsoDeactivate) => {
          const target = departing
          if (!target) return
          void run(async () => {
            await adapter.updateStaffFacts(target.id, { leftOn })
            if (alsoDeactivate && target.isActive) {
              await adapter.setActive(target.id, false)
            }
            setDeparting(null)
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
      <label htmlFor={id} className="block text-sm font-semibold">
        {label}
      </label>
      {children}
    </div>
  )
}

/**
 * Correcting the address an account signs in with.
 *
 * Its own sheet rather than a general "edit account", because this exists for
 * one situation — somebody typed it wrong and the person cannot get in — and a
 * form that also renamed and re-roled them would bury the thing being fixed.
 */
function ChangeEmailSheet({
  account,
  busy,
  onClose,
  onSubmit,
}: {
  account: AccountSummary | null
  busy: boolean
  onClose: () => void
  onSubmit: (email: string) => void
}) {
  const [email, setEmail] = useState(() =>
    account?.email && !isPlaceholderAddress(account.email) ? account.email : '',
  )

  return (
    <FormSheet
      open={account !== null}
      onClose={onClose}
      /*
        Named for the consequence rather than the field, which also keeps the
        dialog's aria-label out of the way: a sheet titled "Change email" is
        matched by any substring search for "Email", including the one meant for
        the provisioning form's field, and a closed <dialog> keeps its label.
      */
      title={account ? `Change sign-in address for ${account.fullName}` : 'Change sign-in address'}
      footer={
        <button
          type="submit"
          form="change-email"
          disabled={busy || email.trim() === ''}
          className={`${buttonVariants({ size: 'phone' })} w-full`}
        >
          {busy ? 'Saving…' : 'Save this address'}
        </button>
      }
    >
      <form
        id="change-email"
        noValidate
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit(email)
        }}
      >
        <Field label="Email" id="correct-email">
          <Input
            id="correct-email"
            type="email"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>
        <p className="rounded-lg border border-border bg-surface-raised p-2 text-xs text-content-muted">
          This is the address they sign in with. Any one-time code you have already given them still
          works — a code belongs to the account, not to the address — so there is no need to issue a
          new one.
        </p>
      </form>
    </FormSheet>
  )
}

/**
 * The staff facts, edited as this session under Row-Level Security. The staff
 * code is shown and inert for anyone but the owner — the `staff_code_guard`
 * trigger is the boundary, and the disabled field is how the surface avoids
 * having it discovered by attempting it.
 */
function EditPersonSheet({
  account,
  isOwner,
  busy,
  onClose,
  onSubmit,
}: {
  account: AccountSummary | null
  isOwner: boolean
  busy: boolean
  onClose: () => void
  onSubmit: (patch: {
    fullName?: string
    roleTitle?: string | null
    joinedOn?: string | null
    staffCode?: string
  }) => void
}) {
  const [fullName, setFullName] = useState(account?.fullName ?? '')
  const [roleTitle, setRoleTitle] = useState(account?.roleTitle ?? '')
  const [joinedOn, setJoinedOn] = useState(account?.joinedOn ?? '')
  const [staffCode, setStaffCode] = useState(account?.staffCode ?? '')

  const person = account !== null && isOutletPerson(account)

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!account || !fullName.trim()) return
    onSubmit({
      fullName: fullName.trim(),
      ...(person && {
        roleTitle: roleTitle.trim() || null,
        joinedOn: joinedOn || null,
        // Sent only when it actually changed: writing a code back unchanged is
        // not a change, but sending it on every ordinary edit invites the
        // owner-only refusal for no reason.
        ...(isOwner && staffCode.trim() && staffCode.trim() !== account.staffCode
          ? { staffCode: staffCode.trim() }
          : {}),
      }),
    })
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

        {person && (
          <>
            <Field label="Staff code" id="edit-staff-code">
              <Input
                id="edit-staff-code"
                value={staffCode}
                disabled={!isOwner}
                onChange={(event) => setStaffCode(event.target.value)}
              />
              {!isOwner && (
                <p className="text-xs text-content-muted">
                  Only the owner can change a staff code — it identifies this person’s records.
                </p>
              )}
            </Field>

            <Field label="Job title (optional)" id="edit-role-title">
              <Input
                id="edit-role-title"
                placeholder="Grill, counter, prep…"
                value={roleTitle}
                onChange={(event) => setRoleTitle(event.target.value)}
              />
            </Field>

            <Field label="Joined on (optional)" id="edit-joined-on">
              <Input
                id="edit-joined-on"
                type="date"
                value={joinedOn}
                onChange={(event) => setJoinedOn(event.target.value)}
              />
            </Field>
          </>
        )}
      </form>
    </FormSheet>
  )
}

/**
 * Departure. Two facts are offered in one confirmation — the person leaves
 * the staff list (every recorded day survives), and their sign-in is cut —
 * because the common case wants both and forgetting the second leaves an
 * ex-employee with a working login. The deactivation is pre-selected but
 * declinable: the two facts are independent by design.
 */
function MarkLeftSheet({
  account,
  busy,
  onClose,
  onSubmit,
}: {
  account: AccountSummary | null
  busy: boolean
  onClose: () => void
  onSubmit: (leftOn: string, alsoDeactivate: boolean) => void
}) {
  const [leftOn, setLeftOn] = useState(() => new Date().toISOString().slice(0, 10))
  const [alsoDeactivate, setAlsoDeactivate] = useState(true)

  function submit(event: FormEvent) {
    event.preventDefault()
    if (leftOn) onSubmit(leftOn, alsoDeactivate)
  }

  return (
    <FormSheet
      open={account !== null}
      onClose={onClose}
      title={account ? `${account.fullName} is leaving` : 'Mark as left'}
      footer={
        <button
          type="submit"
          form="mark-left"
          disabled={busy || !leftOn}
          className={`${buttonVariants({ size: 'phone' })} w-full`}
        >
          {busy ? 'Saving…' : 'Mark as left'}
        </button>
      }
    >
      <form id="mark-left" onSubmit={submit} className="space-y-4" noValidate>
        <p className="text-sm text-content-muted">
          They leave the staff list and new attendance days. Every day they worked stays on the
          record — nothing is deleted, and they can be marked as returned later.
        </p>

        <Field label="Last day" id="left-on">
          <Input
            id="left-on"
            type="date"
            required
            value={leftOn}
            onChange={(event) => setLeftOn(event.target.value)}
          />
        </Field>

        {account?.isActive && (
          <label className="flex items-center gap-2 text-sm text-content">
            <input
              type="checkbox"
              checked={alsoDeactivate}
              onChange={(event) => setAlsoDeactivate(event.target.checked)}
            />
            Also deactivate their sign-in (recommended)
          </label>
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
 * Everything here earns its line. The address is the exception worth keeping
 * text for: it is the last cheap moment to catch a typo before the message goes.
 */
function IssuedCodePanel({
  issued,
  onDismiss,
}: {
  issued: IssuedCode & { name: string; email: string | null }
  onDismiss: () => void
}) {
  const link = activationLink(issued.code)

  return (
    <div
      data-testid="issued-code"
      className="mb-4 rounded-xl border border-border bg-surface-raised p-4"
    >
      <p className="text-sm font-semibold text-content">Activation link for {issued.name}</p>
      {/*
        A wrong address here produces an account whose owner opens the link and
        finds somebody else's email on it — recoverable, but only if it is
        caught. This is the cheap place to catch it; the form has already gone.
      */}
      {issued.email && (
        <p data-testid="issued-code-email" className="break-all text-sm text-content-muted">
          Signs in as <strong className="text-content">{issued.email}</strong> — check this.
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
