import { MessageCircleOff } from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router'

import { ConfirmDialog } from '@/components/layout/confirm-dialog'
import { EmptyState } from '@/components/layout/empty-state'
import { FormSheet } from '@/components/layout/form-sheet'
import { PageHeader } from '@/components/layout/page-header'
import { AddButton } from '@/components/ui/add-button'
import { Button } from '@/components/ui/button'
import { Chip, ChipRow } from '@/components/ui/chip'
import { Input } from '@/components/ui/input'
import { LoadingTable } from '@/components/ui/loading'
import { Toast, useToast } from '@/components/ui/toast'
import { useAdapters } from '@/data-access'
import type { StoppedCustomer } from '@/data-access/campaigns'
import { formatDate } from '@/domain'

import { messageOf } from './words'

/**
 * The stopped list (a-campaign-goes-out-on-whatsapp, #85): the customers who
 * must not be sent a campaign.
 *
 * A customer gets here by replying STOP to a campaign, or because an owner
 * added them for somebody who asked at the counter. Once here they are in no
 * audience, whatever its filters say, and are passed over if their turn comes
 * in a campaign already scheduled.
 *
 * It stops campaigns and nothing else: their receipts and their points go on
 * as before. The page says that once, where a number is added.
 *
 * A name and the last four digits, as an audience shows them. The owner types a
 * whole number to add somebody; the page never shows one back.
 */
export function StoppedSurface() {
  const { campaigns } = useAdapters()
  const navigate = useNavigate()
  const location = useLocation()
  const toast = useToast()
  const [rows, setRows] = useState<StoppedCustomer[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reads, setReads] = useState(0)
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<StoppedCustomer | null>(null)
  const [busy, setBusy] = useState(false)

  const back = useCallback(() => {
    if (location.key === 'default') void navigate('..', { relative: 'path', replace: true })
    else void navigate(-1)
  }, [location.key, navigate])

  useEffect(() => {
    let active = true
    campaigns
      .stopped()
      .then((value) => {
        if (active) setRows(value)
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(messageOf(cause, 'Could not load the stopped list. Try again in a moment.'))
        }
      })
    return () => {
      active = false
    }
  }, [campaigns, reads])

  async function remove(customer: StoppedCustomer) {
    setBusy(true)
    setError(null)
    try {
      await campaigns.removeStopped(customer.customerId)
      setRemoving(null)
      setReads((n) => n + 1)
      toast.show({ text: 'Removed' })
    } catch (cause) {
      setRemoving(null)
      setError(messageOf(cause, 'That did not work. Try again in a moment.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        onBack={back}
        title="Stopped"
        action={<AddButton label="Add a number" onClick={() => setAdding(true)} />}
      />

      {error && (
        <p role="alert" className="mb-3 text-sm font-semibold text-danger">
          {error}
        </p>
      )}

      {rows === null ? (
        error ? null : (
          <LoadingTable
            label="the stopped list"
            rows={5}
            rowHeight="h-16"
            data-testid="stopped-loading"
          />
        )
      ) : rows.length === 0 ? (
        <EmptyState
          icon={MessageCircleOff}
          title="Nobody has asked to stop. A customer who replies STOP to a campaign appears here."
        />
      ) : (
        <ul
          data-testid="stopped-list"
          className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface"
        >
          {rows.map((row) => (
            <li
              key={row.customerId}
              data-testid={`stopped-${row.customerId}`}
              className="flex min-h-16 items-center gap-3 px-3 py-2"
            >
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-baseline gap-2">
                  <span
                    className={
                      row.name
                        ? 'truncate font-bold text-content'
                        : 'truncate font-semibold text-content-muted'
                    }
                  >
                    {row.name ?? 'No saved name'}
                  </span>
                  <span className="shrink-0 text-sm tabular-nums text-content-muted">
                    <span aria-hidden>•••• </span>
                    <span className="sr-only">number ending </span>
                    {row.phoneLast4}
                  </span>
                </span>
                <ChipRow className="mt-1">
                  <Chip>
                    {row.source === 'reply'
                      ? 'replied STOP'
                      : `added by ${row.recordedByName ?? 'an owner'}`}
                  </Chip>
                  {row.campaignName && <Chip>{row.campaignName}</Chip>}
                  <Chip>{formatDate(row.stoppedAt)}</Chip>
                </ChipRow>
              </span>
              <Button
                variant="secondary"
                size="phone"
                aria-label={`Remove ${row.name ?? `the number ending ${row.phoneLast4}`}`}
                data-testid={`remove-stopped-${row.customerId}`}
                onClick={() => setRemoving(row)}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <AddSheet
          onClose={() => setAdding(false)}
          onAdded={() => {
            setAdding(false)
            setReads((n) => n + 1)
            toast.show({ text: 'Added' })
          }}
        />
      )}

      <ConfirmDialog
        open={removing !== null}
        busy={busy}
        title={
          removing ? `Remove ${removing.name ?? `the number ending ${removing.phoneLast4}`}?` : ''
        }
        consequence="They can be sent campaigns again, from the next one scheduled. Do this only when they have asked for it."
        confirmLabel="Remove"
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          if (removing) void remove(removing)
        }}
      />

      <Toast toast={toast.current} testId="stopped-toast" />
    </div>
  )
}

function AddSheet({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const { campaigns } = useAdapters()
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await campaigns.addStopped(phone)
      onAdded()
    } catch (cause) {
      setError(messageOf(cause, 'That number was not added. Try again in a moment.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <FormSheet
      open
      onClose={onClose}
      title="Add a number"
      error={error}
      busy={busy}
      footer={
        <Button
          type="submit"
          form="stopped-add-form"
          size="phone"
          className="w-full"
          disabled={busy || phone.trim() === ''}
          data-testid="save-stopped"
        >
          {busy ? 'Adding…' : 'Add'}
        </Button>
      }
    >
      <form id="stopped-add-form" onSubmit={submit} noValidate className="space-y-2">
        <label htmlFor="stopped-phone" className="block text-sm font-semibold text-content">
          Their mobile number
        </label>
        <Input
          id="stopped-phone"
          required
          data-autofocus
          inputMode="tel"
          autoComplete="off"
          value={phone}
          placeholder="XXXXX-XXXXX"
          data-testid="stopped-phone"
          onChange={(event) => {
            setPhone(event.target.value)
            setError(null)
          }}
        />
        <p className="text-xs text-content-muted">
          Campaigns only. Their receipts and points carry on.
        </p>
      </form>
    </FormSheet>
  )
}
