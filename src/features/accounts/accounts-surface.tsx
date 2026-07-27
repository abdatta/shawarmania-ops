import { Users } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'

import { ConfirmDialog } from '@/components/layout/confirm-dialog'
import { DataTable, type DataTableColumn } from '@/components/layout/data-table'
import { EmptyState } from '@/components/layout/empty-state'
import { FormSheet } from '@/components/layout/form-sheet'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { buttonVariants } from '@/components/ui/button-variants'
import { Input } from '@/components/ui/input'
import { useAdapters, type Tables } from '@/data-access'
import {
  AccountActionError,
  type AccountSummary,
  type AppRole,
  type IssuedCode,
} from '@/data-access/adapters'
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
 */

const ROLE_ORDER: AppRole[] = ['super_admin', 'franchise_admin', 'biller', 'employee']

interface Draft {
  fullName: string
  email: string
  phone: string
  role: AppRole
  outletId: string
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
  const [issued, setIssued] = useState<(IssuedCode & { name: string }) | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [pendingDeactivation, setPendingDeactivation] = useState<AccountSummary | null>(null)

  const [draft, setDraft] = useState<Draft>({
    fullName: '',
    email: '',
    phone: '',
    role: isOwner ? 'employee' : 'employee',
    outletId: session.outletId ?? '',
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
        cause instanceof AccountActionError
          ? cause.message
          : 'That did not work. Try again in a moment.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function onProvision(event: FormEvent) {
    event.preventDefault()
    const outletId = draft.role === 'super_admin' ? null : draft.outletId || null
    await run(async () => {
      const code = await adapter.provision({
        fullName: draft.fullName,
        email: draft.email,
        phone: draft.phone.trim() || null,
        role: draft.role,
        outletId,
      })
      setIssued({ ...code, name: draft.fullName })
      setFormOpen(false)
      setDraft((current) => ({ ...current, fullName: '', email: '', phone: '' }))
    })
  }

  const columns: DataTableColumn<AccountSummary>[] = [
    {
      id: 'name',
      header: 'Name',
      cell: (row) => (
        <span className="font-semibold text-content">
          {row.fullName}
          {row.id === session.userId && <span className="text-content-muted"> (you)</span>}
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
      cell: (row) =>
        !row.isActive ? (
          <span className="font-semibold text-danger">Deactivated</span>
        ) : row.invite ? (
          <span className="text-content-muted">Awaiting activation</span>
        ) : (
          <span className="text-content-muted">Active</span>
        ),
    },
    {
      id: 'actions',
      header: 'Actions',
      align: 'right',
      cell: (row) =>
        row.id === session.userId ? (
          <span className="text-xs text-content-muted">—</span>
        ) : (
          <span className="flex justify-end gap-1">
            <Button
              variant="ghost"
              size="phone"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const code = await adapter.reissue(row.id)
                  setIssued({ ...code, name: row.fullName })
                })
              }
            >
              New code
            </Button>
            {row.isActive ? (
              <Button
                variant="ghost"
                size="phone"
                disabled={busy}
                onClick={() => setPendingDeactivation(row)}
              >
                Deactivate
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="phone"
                disabled={busy}
                onClick={() => void run(() => adapter.setActive(row.id, true))}
              >
                Reactivate
              </Button>
            )}
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
        action={
          <button
            type="button"
            className={buttonVariants({ size: 'phone' })}
            onClick={() => setFormOpen(true)}
          >
            Add account
          </button>
        }
      />

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
            </Field>
          )}
        </form>
      </FormSheet>

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
 * The code, once. There is nowhere to look it up afterwards — only a hash is
 * stored, and that column is unreadable by every client — so this panel says
 * so rather than letting an admin discover it by navigating away.
 */
function IssuedCodePanel({
  issued,
  onDismiss,
}: {
  issued: IssuedCode & { name: string }
  onDismiss: () => void
}) {
  const [copied, setCopied] = useState(false)

  return (
    <div
      data-testid="issued-code"
      className="mb-4 rounded-xl border border-border bg-surface-raised p-4"
    >
      <p className="text-sm font-semibold text-content">One-time code for {issued.name}</p>
      <p className="my-2 font-mono text-2xl font-bold tracking-widest text-content">
        {issued.code}
      </p>
      <p className="text-sm text-content-muted">
        Pass this on now — it is shown once and cannot be looked up again. It works once, and
        expires {new Date(issued.expiresAt).toLocaleDateString('en-IN', { dateStyle: 'medium' })}.
        If it is lost, issue a new one.
      </p>
      <div className="mt-3 flex gap-2">
        <Button
          variant="secondary"
          size="phone"
          onClick={() => {
            void navigator.clipboard
              ?.writeText(issued.code)
              .then(() => setCopied(true))
              .catch(() => setCopied(false))
          }}
        >
          {copied ? 'Copied' : 'Copy code'}
        </Button>
        <Button variant="ghost" size="phone" onClick={onDismiss}>
          Done
        </Button>
      </div>
    </div>
  )
}
