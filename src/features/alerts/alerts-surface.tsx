import {
  ArrowUp,
  Bell,
  CheckCheck,
  ChevronsUp,
  CircleDot,
  Minus,
  type LucideIcon,
} from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'

import { EmptyState } from '@/components/layout/empty-state'
import { FormSheet } from '@/components/layout/form-sheet'
import { PageHeader } from '@/components/layout/page-header'
import { AddButton } from '@/components/ui/add-button'
import { Button } from '@/components/ui/button'
import { buttonVariants } from '@/components/ui/button-variants'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { LoadingList } from '@/components/ui/loading'
import { Select } from '@/components/ui/select'
import { useAdapters } from '@/data-access'
import {
  DataActionError,
  type AlertCategory,
  type AlertDetail,
  type AlertPriorityValue,
  type AlertStatusValue,
  type AlertSummary,
} from '@/data-access/adapters'
import { ALERT_STATUS_LABELS, formatDateTime, nextStatuses } from '@/domain'
import { useSession } from '@/session/context'

/**
 * Alerts — one component, both roles.
 *
 * The Super Admin gets a cross-outlet inbox with each alert's outlet named; a
 * Franchise Admin gets their own outlet's and can raise one. The difference is
 * the adapter's, not this screen's: a manager asking for another outlet is
 * handed nothing, exactly as the policy will hand them nothing.
 *
 * **Priority is a word and a shape, never a colour on its own.** Roughly one man
 * in twelve has a colour-vision deficiency, and this is a list read at speed by
 * somebody deciding what to deal with first.
 */

const CATEGORIES: AlertCategory[] = [
  'inventory',
  'equipment',
  'cash_mismatch',
  'employee',
  'supplier',
  'other',
]

const CATEGORY_LABELS: Record<AlertCategory, string> = {
  inventory: 'Stock',
  equipment: 'Equipment',
  cash_mismatch: 'Cash mismatch',
  employee: 'Staff',
  supplier: 'Supplier',
  other: 'Something else',
}

const PRIORITIES: AlertPriorityValue[] = ['low', 'normal', 'high', 'urgent']

const PRIORITY_LABELS: Record<AlertPriorityValue, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  urgent: 'Urgent',
}

/** A distinct glyph per priority, so the ranking survives without colour. */
const PRIORITY_ICONS: Record<AlertPriorityValue, LucideIcon> = {
  low: Minus,
  normal: CircleDot,
  high: ArrowUp,
  urgent: ChevronsUp,
}

const STATUS_ACTION_LABELS: Record<AlertStatusValue, string> = {
  open: 'Reopen',
  acknowledged: 'Acknowledge',
  resolved: 'Resolve',
  closed: 'Close',
}

export function AlertsSurface() {
  const session = useSession()
  const { alerts: adapter } = useAdapters()

  const [rows, setRows] = useState<AlertSummary[]>()
  const [openId, setOpenId] = useState<string | null>(null)
  const [detail, setDetail] = useState<AlertDetail | null>(null)
  const [raising, setRaising] = useState(false)
  const [reply, setReply] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<{
    category: AlertCategory
    priority: AlertPriorityValue
    subject: string
    message: string
  }>({ category: 'inventory', priority: 'normal', subject: '', message: '' })

  const isOwner = session.role === 'super_admin'

  const load = useCallback(async () => {
    setRows(await adapter.listAlerts())
    if (openId) setDetail(await adapter.getAlert(openId))
  }, [adapter, openId])

  useEffect(() => {
    let active = true
    void adapter.listAlerts().then((result) => {
      if (active) setRows(result)
    })
    return () => {
      active = false
    }
  }, [adapter])

  useEffect(() => {
    // Closing clears the detail where the closing happens, not here: an effect
    // that setStates on the way out costs a cascading render to say something
    // the event handler already knew.
    if (!openId) return
    let active = true
    void adapter.getAlert(openId).then((result) => {
      if (active) setDetail(result)
    })
    return () => {
      active = false
    }
  }, [adapter, openId])

  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await action()
      await load()
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

  async function submitAlert(event: FormEvent) {
    event.preventDefault()
    if (!session.outletId) return

    await run(async () => {
      await adapter.raiseAlert({
        outletId: session.outletId as string,
        category: draft.category,
        priority: draft.priority,
        subject: draft.subject,
        message: draft.message,
      })
      setDraft({ category: 'inventory', priority: 'normal', subject: '', message: '' })
      setRaising(false)
    })
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Alerts"
        subtitle={
          isOwner
            ? 'Everything raised across your outlets, with what needs reading first at the top.'
            : 'What you have raised with the owner, and what they said.'
        }
        action={
          isOwner ? undefined : (
            <AddButton
              label="Raise an alert"
              data-testid="raise-alert"
              onClick={() => {
                setError(null)
                setRaising(true)
              }}
            />
          )
        }
      />

      {error && !raising && !openId && (
        <p role="alert" className="mb-3 text-sm font-semibold text-danger">
          {error}
        </p>
      )}

      {rows === undefined ? (
        // The `space-y-2` list of alert buttons, each a subject line over the
        // detail line beneath it.
        <LoadingList
          label="the alerts"
          rows={4}
          blockHeight="h-20"
          className="space-y-2"
          data-testid="alerts-loading"
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Bell}
          title={
            isOwner
              ? 'Nothing has been raised yet. Alerts appear here the moment a manager raises one.'
              : 'Nothing raised. If something needs the owner’s attention — stock, equipment, a cash difference — raise it here.'
          }
        />
      ) : (
        <ul className="space-y-2" data-testid="alert-list">
          {rows.map((alert) => (
            <li key={alert.id}>
              <button
                type="button"
                data-testid={`alert-${alert.id}`}
                onClick={() => {
                  setError(null)
                  setReply('')
                  setOpenId(alert.id)
                }}
                className="w-full rounded-xl border border-border bg-surface p-3 text-left shadow-sm hover:bg-surface-raised focus-visible:focus-ring"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold text-content">{alert.subject}</span>
                  <StatusBadge status={alert.status} />
                </div>
                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-content-muted">
                  <PriorityMark priority={alert.priority} />
                  <span>{CATEGORY_LABELS[alert.category]}</span>
                  {isOwner && (
                    <span data-testid={`alert-outlet-${alert.id}`}>· {alert.outletName}</span>
                  )}
                  <span>· {alert.raisedByName}</span>
                  <span>· {formatDateTime(alert.createdAt)}</span>
                  {alert.responseCount > 0 && (
                    <span>
                      · {alert.responseCount === 1 ? '1 reply' : `${alert.responseCount} replies`}
                    </span>
                  )}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}

      <FormSheet
        open={openId !== null}
        onClose={() => {
          setOpenId(null)
          setDetail(null)
        }}
        title={detail?.subject ?? 'Alert'}
        error={error}
      >
        {detail && (
          <div className="space-y-4" data-testid="alert-detail">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-content-muted">
              <PriorityMark priority={detail.priority} />
              <StatusBadge status={detail.status} />
              <span>· {CATEGORY_LABELS[detail.category]}</span>
              <span>· {detail.outletName}</span>
            </p>

            <Card className="text-sm text-content">
              <p>{detail.message}</p>
              <p className="mt-2 text-xs text-content-muted">
                {detail.raisedByName} · {formatDateTime(detail.createdAt)}
              </p>
            </Card>

            {detail.responses.length > 0 && (
              <ul className="space-y-2" data-testid="alert-responses">
                {detail.responses.map((response) => (
                  <li
                    key={response.id}
                    className="rounded-lg border border-border bg-surface-raised p-3 text-sm"
                  >
                    <p className="text-content">{response.message}</p>
                    <p className="mt-1 text-xs text-content-muted">
                      {response.responderName} · {formatDateTime(response.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}

            <form
              className="space-y-2"
              noValidate
              onSubmit={(event) => {
                event.preventDefault()
                void run(async () => {
                  await adapter.respond(detail.id, reply)
                  setReply('')
                })
              }}
            >
              <label htmlFor="alert-reply" className="block text-sm font-semibold">
                Reply
              </label>
              <Input
                id="alert-reply"
                data-testid="alert-reply"
                value={reply}
                placeholder="Add to the thread"
                onChange={(event) => setReply(event.target.value)}
              />
              <Button type="submit" size="phone" variant="secondary" disabled={busy}>
                Send reply
              </Button>
              <p className="text-xs text-content-muted">
                A reply is a reply. It does not move the alert along — that is a separate,
                deliberate action below.
              </p>
            </form>

            <div className="space-y-2 border-t border-border pt-3">
              <p className="text-sm font-semibold text-content">
                Status — {ALERT_STATUS_LABELS[detail.status]}
              </p>
              {nextStatuses(detail.status).length === 0 ? (
                <p className="text-xs text-content-muted" data-testid="alert-terminal">
                  This alert is closed. A closed alert is finished with — if it comes back, raise a
                  new one so the history of both stays readable.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {nextStatuses(detail.status).map((status) => (
                    <Button
                      key={status}
                      size="phone"
                      variant={status === 'open' ? 'secondary' : 'primary'}
                      disabled={busy}
                      data-testid={`set-status-${status}`}
                      onClick={() => void run(() => adapter.setStatus(detail.id, status))}
                    >
                      {status === 'closed' && <CheckCheck aria-hidden size={16} />}
                      {STATUS_ACTION_LABELS[status]}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </FormSheet>

      <FormSheet
        open={raising}
        onClose={() => setRaising(false)}
        title="Raise an alert"
        error={error}
        footer={
          <button
            type="submit"
            form="alert-form"
            disabled={busy}
            className={`${buttonVariants({ size: 'phone' })} w-full`}
          >
            {busy ? 'Sending…' : 'Raise it'}
          </button>
        }
      >
        <form id="alert-form" onSubmit={submitAlert} className="space-y-4" noValidate>
          <Field label="What is it about" id="alert-category">
            <Select
              id="alert-category"
              value={draft.category}
              onChange={(event) =>
                setDraft({ ...draft, category: event.target.value as AlertCategory })
              }
            >
              {CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {CATEGORY_LABELS[category]}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="How urgent" id="alert-priority">
            <Select
              id="alert-priority"
              value={draft.priority}
              onChange={(event) =>
                setDraft({ ...draft, priority: event.target.value as AlertPriorityValue })
              }
            >
              {PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {PRIORITY_LABELS[priority]}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Subject" id="alert-subject">
            <Input
              id="alert-subject"
              required
              value={draft.subject}
              placeholder="e.g. Pita bread will not last tomorrow"
              onChange={(event) => setDraft({ ...draft, subject: event.target.value })}
            />
          </Field>

          <Field label="What happened" id="alert-message">
            <textarea
              id="alert-message"
              required
              rows={4}
              value={draft.message}
              placeholder="What the owner needs to know, and what you need from them"
              onChange={(event) => setDraft({ ...draft, message: event.target.value })}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-content placeholder:text-content-muted focus-visible:focus-ring"
            />
          </Field>
        </form>
      </FormSheet>
    </div>
  )
}

function PriorityMark({ priority }: { priority: AlertPriorityValue }) {
  const Icon = PRIORITY_ICONS[priority]
  return (
    <span
      className="inline-flex items-center gap-1 font-semibold text-content"
      data-testid={`priority-${priority}`}
      data-priority={priority}
    >
      <Icon aria-hidden size={14} />
      {PRIORITY_LABELS[priority]}
    </span>
  )
}

function StatusBadge({ status }: { status: AlertStatusValue }) {
  return (
    <span
      data-status={status}
      className="rounded-full border border-border px-2 py-0.5 text-xs font-semibold text-content"
    >
      {ALERT_STATUS_LABELS[status]}
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
