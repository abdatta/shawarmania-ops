import { Check, Pencil, Star, StarOff, X } from 'lucide-react'
import { useEffect, useState } from 'react'

import { ConfirmDialog } from '@/components/layout/confirm-dialog'
import { buttonVariants } from '@/components/ui/button-variants'
import { Shimmer } from '@/components/ui/loading'
import { MemberMark } from '@/components/ui/member-mark'
import { Modal } from '@/components/ui/modal'
import { Money } from '@/components/ui/money'
import { useAdapters } from '@/data-access'
import { DataActionError, type DirectoryCustomerCard } from '@/data-access/adapters'
import { formatDate } from '@/domain'
import { cn } from '@/lib/cn'
import { formatIndianPhone } from '../../../shared/phone'

import { visitsLabel } from './visits-label'

/**
 * One customer's card, over the Customers page — the owner's, or a manager's
 * over their own outlets.
 *
 * ```
 *   Rahul Sharma                       ✎
 *   +91 98765 43210
 *   ⭐ Gold member since 12 Aug 2026    ⊘
 *   ─────────────────────────────────
 *   Last 30 days
 *   14 visits              ₹9,240
 *   Last seen            14 Sep 2026
 *   Customer since       12 Mar 2026
 * ```
 *
 * **Status rows, not buttons.** The name and the membership each read as a
 * line of text with one small icon-only control beside it, and there is no
 * action button at the foot: the card is a thing to read, with two things that
 * can be changed in place.
 *
 * **The icon carries the verb; the text carries the state.** A pencil means
 * edit, so the membership control is a star to grant and a crossed-out star to
 * revoke — the row beside it already says which they are.
 *
 * **Both directions confirm, identically**, through the shared
 * `ConfirmDialog`. One direction asking and the other not is where people
 * mis-tap. It opens over this card; `Modal` already keeps a dismissed
 * confirmation from closing the card beneath it.
 */
export function CustomerCardDialog({
  customerId,
  onClose,
  onChanged,
}: {
  customerId: string | null
  onClose: () => void
  /** Something on the card changed; here is the card as it now reads. */
  onChanged: (card: DirectoryCustomerCard) => void
}) {
  return (
    <Modal
      open={customerId !== null}
      onClose={onClose}
      aria-label="Customer"
      className="m-auto w-[min(94vw,24rem)] rounded-2xl p-4"
    >
      {customerId !== null && (
        <CardBody
          key={customerId}
          customerId={customerId}
          onClose={onClose}
          onChanged={onChanged}
        />
      )}
    </Modal>
  )
}

const ICON_BUTTON = cn(
  buttonVariants({ variant: 'ghost', size: 'phone' }),
  'w-[var(--size-control-phone)] shrink-0 px-0',
)

function CardBody({
  customerId,
  onClose,
  onChanged,
}: {
  customerId: string
  onClose: () => void
  onChanged: (card: DirectoryCustomerCard) => void
}) {
  const { customerDirectory } = useAdapters()
  const [card, setCard] = useState<DirectoryCustomerCard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<'grant' | 'revoke' | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let current = true
    customerDirectory
      .card(customerId)
      .then((next) => {
        if (current) setCard(next)
      })
      .catch((cause: unknown) => {
        if (current) setError(messageOf(cause, 'This customer could not be loaded.'))
      })
    return () => {
      current = false
    }
  }, [customerDirectory, customerId])

  async function run(action: () => Promise<DirectoryCustomerCard>, fallback: string) {
    setBusy(true)
    setError(null)
    try {
      const next = await action()
      setCard(next)
      onChanged(next)
      return true
    } catch (cause) {
      setError(messageOf(cause, fallback))
      return false
    } finally {
      setBusy(false)
    }
  }

  async function saveName() {
    if (card === null || renaming === null) return
    const next = renaming.trim()
    // Corrected, never erased: the tick is unavailable while this is blank.
    if (next === '') return
    if (next === (card.name ?? '')) {
      setRenaming(null)
      return
    }
    if (await run(() => customerDirectory.rename(card.id, next), 'The name could not be saved.')) {
      setRenaming(null)
    }
  }

  async function changeMembership() {
    if (card === null || confirming === null) return
    const action =
      confirming === 'grant'
        ? () => customerDirectory.grantMembership(card.id)
        : () => customerDirectory.revokeMembership(card.id)
    await run(action, 'The membership could not be changed.')
    setConfirming(null)
  }

  const who = card?.name ?? 'this customer'

  return (
    <div data-testid="customer-card">
      <div className="-mt-1 -mr-2 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-content-muted">Customer</p>
        <button type="button" aria-label="Close" onClick={onClose} className={ICON_BUTTON}>
          <X aria-hidden size={18} />
        </button>
      </div>

      {card === null ? (
        error ? (
          <p role="alert" className="py-6 text-sm font-semibold text-danger">
            {error}
          </p>
        ) : (
          <div aria-busy="true" aria-label="Loading this customer" className="space-y-2 py-1">
            <Shimmer className="h-7 w-3/4" />
            <Shimmer className="h-5 w-1/2" />
            <Shimmer className="h-11 w-full" />
            <Shimmer className="mt-4 h-24 w-full" />
          </div>
        )
      ) : (
        <>
          {/* ── The name, correctable in place ─────────────────────────── */}
          {renaming === null ? (
            <div className="flex min-h-[var(--size-control-phone)] items-center gap-2">
              <h2
                data-testid="customer-card-name"
                className={cn(
                  'min-w-0 flex-1 truncate text-xl font-black',
                  card.name ? 'text-content' : 'text-content-muted',
                )}
              >
                {card.name ?? 'No saved name'}
              </h2>
              {card.editable && (
                <button
                  type="button"
                  aria-label="Correct the name"
                  data-testid="customer-card-rename"
                  onClick={() => setRenaming(card.name ?? '')}
                  className={ICON_BUTTON}
                >
                  <Pencil aria-hidden size={18} />
                </button>
              )}
            </div>
          ) : (
            <form
              className="mb-1 flex items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                void saveName()
              }}
            >
              <label htmlFor="customer-card-name-input" className="sr-only">
                Name
              </label>
              <input
                id="customer-card-name-input"
                data-testid="customer-card-name-input"
                // Focused on arrival: the pencil was a request to type.
                autoFocus
                value={renaming}
                onChange={(event) => setRenaming(event.target.value)}
                enterKeyHint="done"
                maxLength={80}
                className="h-[var(--size-control-phone)] min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 text-lg font-bold text-content focus-visible:focus-ring"
              />
              <button
                type="submit"
                aria-label="Save the name"
                data-testid="customer-card-save-name"
                disabled={busy || renaming.trim() === ''}
                className={cn(ICON_BUTTON, 'text-primary disabled:opacity-40')}
              >
                <Check aria-hidden size={20} strokeWidth={2.5} />
              </button>
            </form>
          )}

          <p className="text-sm tabular-nums text-content-muted">
            +91 {formatIndianPhone(card.phone)}
          </p>

          {/* ── Membership, as a status row ───────────────────────────── */}
          <div
            data-testid="customer-card-membership"
            className="mt-2 flex min-h-[var(--size-control-phone)] items-center gap-2"
          >
            {card.memberSince !== null ? (
              <>
                <MemberMark />
                <p className="min-w-0 flex-1 text-sm font-semibold text-content">
                  Gold member since {formatDate(card.memberSince)}
                </p>
                {card.editable && (
                  <button
                    type="button"
                    aria-label="Remove gold membership"
                    data-testid="customer-card-revoke"
                    disabled={busy}
                    onClick={() => setConfirming('revoke')}
                    className={ICON_BUTTON}
                  >
                    <StarOff aria-hidden size={18} />
                  </button>
                )}
              </>
            ) : (
              <>
                <p className="min-w-0 flex-1 text-sm font-semibold text-content-muted">
                  Not a gold member
                </p>
                {card.editable && (
                  <button
                    type="button"
                    aria-label="Make gold member"
                    data-testid="customer-card-grant"
                    disabled={busy}
                    onClick={() => setConfirming('grant')}
                    className={ICON_BUTTON}
                  >
                    <Star aria-hidden size={18} />
                  </button>
                )}
              </>
            )}
          </div>

          {/*
            A manager looking at a customer another outlet also serves sees why
            the controls are missing, rather than wondering where they went. One
            sentence, and nothing about which outlet or what was bought there.
          */}
          {!card.editable && (
            <p className="mt-1 text-xs text-content-muted" data-testid="customer-card-read-only">
              Also buys at another outlet, so only the owner can change their name or gold.
            </p>
          )}

          {error && (
            <p role="alert" className="mt-2 text-sm font-semibold text-danger">
              {error}
            </p>
          )}

          {/* ── What they have done, derived when this card opened ────── */}
          <div className="mt-3 border-t border-border pt-3" data-testid="customer-card-figures">
            <p className="text-xs font-semibold uppercase tracking-wide text-content-muted">
              Last 30 days
            </p>
            <div className="mt-1 flex items-baseline justify-between gap-3">
              <span className="text-lg font-black text-content">{visitsLabel(card.visits30d)}</span>
              {/* Labelled, because a bare rupee figure beside a visit count
                  could as easily be an average or a balance [owner, 2026-09-24]. */}
              <span className="flex items-baseline gap-1.5">
                <span className="text-sm font-semibold text-content-muted">Spent</span>
                <Money paise={card.spend30dPaise} className="text-lg font-black text-content" />
              </span>
            </div>
            <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
              <dt className="text-content-muted">Last seen</dt>
              <dd className="text-right font-semibold text-content">
                {card.lastSeenAt ? formatDate(card.lastSeenAt) : 'Not yet'}
              </dd>
              {/* A manager's is their own outlets' first sale, and says so. */}
              <dt className="text-content-muted">
                {card.scope === 'business' ? 'Customer since' : 'First visit here'}
              </dt>
              <dd className="text-right font-semibold text-content">
                {formatDate(card.customerSince)}
              </dd>
            </dl>
          </div>

          <ConfirmDialog
            open={confirming !== null}
            title={
              confirming === 'grant'
                ? `Make ${who} a gold member?`
                : `Remove ${who}’s gold membership?`
            }
            consequence={
              confirming === 'grant'
                ? 'Billers will see a gold star beside them at every outlet, from their next order. Nothing is discounted automatically.'
                : 'The star stops appearing at the counter from their next order. Orders and bills already rung keep theirs.'
            }
            confirmLabel={confirming === 'grant' ? 'Make gold member' : 'Remove gold'}
            busy={busy}
            onConfirm={() => void changeMembership()}
            onClose={() => setConfirming(null)}
          />
        </>
      )}
    </div>
  )
}

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof DataActionError ? cause.message : fallback
}
