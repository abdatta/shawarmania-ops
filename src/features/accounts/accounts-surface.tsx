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
import { useAdapters, type Tables } from '@/data-access'
import {
  DataActionError,
  FAILED_ACTIVATION_NOTICE,
  type AccountSummary,
  type AppRole,
  type EmployeeSummary,
  type IssuedCode,
} from '@/data-access/adapters'
import { activationLink } from '@/lib/activation-link'
import { useSession } from '@/session/context'
import { ROLE_LABELS } from '@/session/session'

/**
 * People (Super Admin, every outlet) and Access (Franchise Admin, their own).
 * One component: the difference between the two is entirely the caller's
 * authority, and writing it twice would be writing the authority rules twice.
 *
 * What the UI restricts here is convenience, not security. A Franchise Admin
 * is offered no role beyond Biller and Employee and no outlet but their own —
 * and the privileged function refuses those combinations again on the server,
 * from the caller's own token, whatever this form sends (design D5).
 *
 * Provisioning an Employee also offers the staff roster, because that is the
 * natural moment to think about it — but it only ever *offers*. The schema
 * separates an app account from a payroll roster row deliberately, and writing
 * one as a silent side effect of the other would assert something the business
 * has not said (outlet-and-staff-setup, design D4).
 */

const ROLE_ORDER: AppRole[] = ['super_admin', 'franchise_admin', 'biller', 'employee']

/** What to do about the staff roster while provisioning an Employee. */
type RosterChoice = 'create' | 'link' | 'none'

interface Draft {
  fullName: string
  email: string
  phone: string
  role: AppRole
  outletId: string
  rosterChoice: RosterChoice
  employeeCode: string
  employeeId: string
}

export function AccountsSurface() {
  const session = useSession()
  const { accounts: adapter, outlets: outletsAdapter, employees: employeesAdapter } = useAdapters()

  const isOwner = session.role === 'super_admin'
  const assignableRoles = useMemo<AppRole[]>(
    () => (isOwner ? ROLE_ORDER : ['biller', 'employee']),
    [isOwner],
  )

  const [accounts, setAccounts] = useState<AccountSummary[] | null>(null)
  const [outlets, setOutlets] = useState<Tables<'outlets'>[]>([])
  const [roster, setRoster] = useState<EmployeeSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const [issued, setIssued] = useState<
    (IssuedCode & { name: string; email: string | null }) | null
  >(null)
  const [correcting, setCorrecting] = useState<AccountSummary | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [pendingDeactivation, setPendingDeactivation] = useState<AccountSummary | null>(null)
  const [failedActivations, setFailedActivations] = useState<number | null>(null)

  const [draft, setDraft] = useState<Draft>({
    fullName: '',
    email: '',
    phone: '',
    role: 'employee',
    outletId: session.outletId ?? '',
    rosterChoice: 'create',
    employeeCode: '',
    employeeId: '',
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
        if (active) setError('Could not load accounts. Try again in a moment.')
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

  // The roster for the outlet the form is currently pointed at — both to offer
  // an existing person to link, and to say on the list whether an Employee
  // account can actually check in.
  const rosterOutletId = draft.role === 'super_admin' ? '' : draft.outletId
  useEffect(() => {
    if (!rosterOutletId) return
    let active = true
    void employeesAdapter
      .listEmployees(rosterOutletId)
      .then((list) => {
        if (active) setRoster(list)
      })
      .catch(() => {
        // A roster that will not load is not a reason to block provisioning —
        // the choice below simply falls back to "not on the roster".
        if (active) setRoster([])
      })
    return () => {
      active = false
    }
  }, [employeesAdapter, rosterOutletId])

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

  /** Unlinked, active people on this outlet's roster — candidates for a link. */
  const linkableEmployees = useMemo(
    () => roster.filter((row) => row.profileId === null && row.employmentStatus === 'active'),
    [roster],
  )

  const rosterProfileIds = useMemo(
    () => new Set(roster.map((row) => row.profileId).filter((id): id is string => id !== null)),
    [roster],
  )

  /**
   * Provisioning is one write; the roster row is a second one, made by this
   * session under RLS rather than by the privileged function (design D3). That
   * means it can fail on its own, and when it does the account still exists and
   * the code is still valid — so the code is shown regardless, and the failure
   * is reported as an unfinished link rather than a failed provisioning.
   */
  async function onProvision(event: FormEvent) {
    event.preventDefault()
    const outletId = draft.role === 'super_admin' ? null : draft.outletId || null

    // Checked before anything is written, not after. The roster row is the
    // second of two writes, so an incomplete answer here would otherwise create
    // the account and then fail — leaving an admin holding a code for somebody
    // who is half set up, over a field they simply had not filled in.
    //
    // The name and address guards below apply to every role, so they sit ahead
    // of the roster branch. Both fields carry attributes that look like they
    // validate and do not: this form has `noValidate`, which makes `required`
    // and `type="email"` inert on submit. A blank name provisions an account
    // that is nobody, and a blank address provisions one nobody can sign in to.
    if (!draft.fullName.trim()) {
      setError('This account needs a name — it is how the person appears everywhere in the app.')
      return
    }
    if (!draft.email.trim()) {
      setError('An email address is needed — it is how this person signs in.')
      return
    }

    if (outletId && draft.role === 'employee') {
      if (draft.rosterChoice === 'create' && !draft.employeeCode.trim()) {
        setError(
          'A staff code is needed to put someone on the staff list — it is how their records are identified. Give one, or choose “Not on the staff list”.',
        )
        return
      }
      if (draft.rosterChoice === 'link' && !draft.employeeId) {
        setError('Choose who they already are on the staff list, or pick another option.')
        return
      }
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
      })
      setIssued({ ...code, name: draft.fullName, email: draft.email.trim().toLowerCase() })
      setFormOpen(false)

      if (outletId && draft.role === 'employee' && draft.rosterChoice !== 'none') {
        try {
          if (draft.rosterChoice === 'create') {
            await employeesAdapter.createEmployee({
              outletId,
              employeeCode: draft.employeeCode,
              fullName: draft.fullName,
              profileId: code.profileId,
            })
          } else if (draft.employeeId) {
            await employeesAdapter.linkAccount(draft.employeeId, code.profileId)
          }
          setRoster(await employeesAdapter.listEmployees(outletId))
        } catch (cause) {
          const detail = cause instanceof DataActionError ? ` ${cause.message}` : ''
          setError(
            `${draft.fullName} has an account and the code below works, but they are not on the staff list yet — so they cannot check in.${detail} Finish it on Staff.`,
          )
        }
      }

      setDraft((current) => ({
        ...current,
        fullName: '',
        email: '',
        phone: '',
        employeeCode: '',
        employeeId: '',
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
          {/*
            Read back on the list because it is otherwise typed once and never
            seen again — and a typo produces an account that refuses the code,
            refuses sign-in, and says the same uninformative thing either way.
          */}
          {row.email && (
            <span
              data-testid={`email-${row.id}`}
              className="block break-all text-xs text-content-muted"
            >
              {row.email}
            </span>
          )}
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
          {!row.isActive ? (
            <span className="font-semibold text-danger">Deactivated</span>
          ) : row.invite ? (
            <span className="text-content-muted">Awaiting activation</span>
          ) : (
            <span className="text-content-muted">Active</span>
          )}
          {/*
            Only Employees are expected on the roster, and only for the outlet
            whose roster is loaded — saying "not on the roster" about someone
            whose roster was never read would be inventing a fact.
          */}
          {row.role === 'employee' && row.outletId === rosterOutletId && (
            <span className="block text-xs">
              {rosterProfileIds.has(row.id) ? (
                <span className="text-content-muted">On the staff list</span>
              ) : (
                <span data-testid={`off-roster-${row.id}`} className="text-warning">
                  Not on the staff list — cannot check in
                </span>
              )}
            </span>
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
                      setIssued({ ...code, name: row.fullName, email: row.email })
                    }),
                },
                {
                  label: 'Change email',
                  disabled: busy,
                  onSelect: () => setCorrecting(row),
                },
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
        title={isOwner ? 'People' : 'Access'}
        subtitle={
          isOwner
            ? 'Every account, across all outlets.'
            : 'App accounts for this outlet. Codes are handed over by you, never emailed.'
        }
        action={<AddButton label="Add account" onClick={() => setFormOpen(true)} />}
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
        <DataTable
          columns={columns}
          rows={accounts}
          rowKey={(row) => row.id}
          empty={
            <EmptyState
              icon={Users}
              title="No accounts yet. Add one to give someone access — you will get a code to pass on."
            />
          }
        />
      )}

      <FormSheet
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title="Add account"
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
            <select
              id="account-role"
              className="h-[var(--size-control)] w-full rounded-lg border border-border bg-surface px-3 text-content focus-visible:focus-ring"
              value={draft.role}
              onChange={(event) => setDraft({ ...draft, role: event.target.value as AppRole })}
            >
              {assignableRoles.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </select>
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
                <select
                  id="account-outlet"
                  className="h-[var(--size-control)] w-full rounded-lg border border-border bg-surface px-3 text-content focus-visible:focus-ring disabled:opacity-50"
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
                </select>
              )}
            </Field>
          )}

          {draft.role === 'employee' && draft.outletId && (
            <fieldset className="space-y-2 rounded-lg border border-border p-3">
              <legend className="px-1 text-sm font-semibold">Staff list</legend>
              <p className="text-xs text-content-muted">
                Attendance follows the staff list, not app accounts. Without a place on it this
                person can sign in and cannot check in.
              </p>

              <RosterOption
                checked={draft.rosterChoice === 'create'}
                onSelect={() => setDraft({ ...draft, rosterChoice: 'create' })}
                label="Add them to the staff list"
              >
                {draft.rosterChoice === 'create' && (
                  <Input
                    aria-label="Staff code"
                    className="mt-2"
                    autoCapitalize="characters"
                    placeholder="Staff code, e.g. KAL-05"
                    value={draft.employeeCode}
                    onChange={(event) => setDraft({ ...draft, employeeCode: event.target.value })}
                  />
                )}
              </RosterOption>

              {linkableEmployees.length > 0 && (
                <RosterOption
                  checked={draft.rosterChoice === 'link'}
                  onSelect={() => setDraft({ ...draft, rosterChoice: 'link' })}
                  label="They are already on the staff list"
                >
                  {draft.rosterChoice === 'link' && (
                    <select
                      aria-label="Person on the staff list"
                      className="mt-2 h-[var(--size-control)] w-full rounded-lg border border-border bg-surface px-3 text-content focus-visible:focus-ring"
                      value={draft.employeeId}
                      onChange={(event) => setDraft({ ...draft, employeeId: event.target.value })}
                    >
                      <option value="">Choose a person</option>
                      {linkableEmployees.map((employee) => (
                        <option key={employee.id} value={employee.id}>
                          {employee.fullName} · {employee.employeeCode}
                        </option>
                      ))}
                    </select>
                  )}
                </RosterOption>
              )}

              <RosterOption
                checked={draft.rosterChoice === 'none'}
                onSelect={() => setDraft({ ...draft, rosterChoice: 'none' })}
                label="Not on the staff list"
              />
            </fieldset>
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

      <ConfirmDialog
        open={pendingDeactivation !== null}
        title="Deactivate this account?"
        consequence={
          pendingDeactivation
            ? `${pendingDeactivation.fullName} stops being able to read or write anything immediately, even if their app is already open. You can reactivate them later.`
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
  const [email, setEmail] = useState(account?.email ?? '')

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

/** One of the three answers to "and the staff list?" — never a silent default. */
function RosterOption({
  checked,
  onSelect,
  label,
  children,
}: {
  checked: boolean
  onSelect: () => void
  label: string
  children?: React.ReactNode
}) {
  return (
    <div>
      <label className="flex items-center gap-2 text-sm text-content">
        <input type="radio" name="roster-choice" checked={checked} onChange={onSelect} />
        {label}
      </label>
      {children}
    </div>
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
