import { useState, type ReactNode } from 'react'

import { Link } from 'react-router'

import { ConfirmDialog } from '@/components/layout/confirm-dialog'
import { Button } from '@/components/ui/button'
import { buttonVariants } from '@/components/ui/button-variants'
import { Card } from '@/components/ui/card'
import { Money } from '@/components/ui/money'
import type { AggregatorSyncEvent, AggregatorSyncEventRow } from '@/data-access/adapters'

import { needsOwner } from './needs-you-count'
import { formatPaise } from '@/domain'
import { cn } from '@/lib/cn'

/**
 * One thing the sync did, as a row.
 *
 * **A row is scanned, not read.** The owner opens this to find out whether
 * anything wants them, and a paragraph answers that question slowly. Each row is
 * therefore a tag, a subject and a figure, in that order, with the tags forming
 * a readable column down the left edge. The only words left are the ones a
 * figure cannot say.
 *
 * **What changed is on the closed row, including what it changed from.** The
 * question this page exists to answer is "why did this day's number move", and a
 * row that only reports movement sends the reader elsewhere to find out.
 *
 * **Only a row that wants something is open.** Everything else is history.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function shortDate(businessDate: string): string {
  // Split rather than parsed through Date, which would apply the device's
  // timezone to a business date that has none and can slip a day westward.
  const [, month, day] = businessDate.split('-').map(Number)
  return `${day} ${MONTHS[(month ?? 1) - 1]}`
}

function range(from: string, to: string): string {
  return `${shortDate(from)} to ${shortDate(to)}`
}

type Tone = 'quiet' | 'attention' | 'wrong'

interface Line {
  /** One or two words, so the left edge can be read as a column. */
  tag: string
  tone: Tone
  /** What it is about: a day, a week, or the thing itself. */
  subject: string
  figure?: ReactNode
  /** The sentence a screen reader gets, since a tag beside a date is not one. */
  spoken: string
}

function lineFor(event: AggregatorSyncEvent): Line {
  switch (event.kind) {
    case 'days-written':
      return {
        tag: 'Read',
        tone: 'quiet',
        subject: range(event.from, event.to),
        figure: `${event.days} ${event.days === 1 ? 'day' : 'days'}`,
        spoken: `${event.days} days of Zomato revenue read, ${range(event.from, event.to)}`,
      }
    case 'week-settled':
      return {
        tag: 'Paid',
        tone: 'quiet',
        subject: range(event.from, event.to),
        figure: <Money paise={event.netPaise} />,
        spoken: `Week of ${range(event.from, event.to)} paid`,
      }
    case 'day-revised':
      return {
        tag: 'Revised',
        tone: 'quiet',
        subject: shortDate(event.businessDate),
        // Both figures, on the closed row. This is the movement most likely to
        // be read as a bug, and it is not one.
        figure: (
          <span className="whitespace-nowrap">
            <Money paise={event.fromNetPaise} className="text-content-muted line-through" />
            <span aria-hidden> → </span>
            <Money paise={event.toNetPaise} />
          </span>
        ),
        // Both figures spoken as well as shown. A screen reader hearing only
        // that a day was revised has been told less than the screen says.
        spoken: `${shortDate(event.businessDate)} revised from ${formatPaise(event.fromNetPaise)} to ${formatPaise(event.toNetPaise)}`,
      }
    case 'week-disputed':
      return {
        tag: 'Off by',
        tone: 'wrong',
        subject: range(event.from, event.to),
        figure: <Money paise={Math.abs(event.differencePaise)} className="text-danger" />,
        spoken: `Week of ${range(event.from, event.to)} does not add up`,
      }
    case 'session-lapsed':
      return {
        tag: 'Signed out',
        tone: 'wrong',
        subject: 'Zomato ended the session',
        spoken: 'Zomato signed us out',
      }
    case 'shape-changed':
      return {
        tag: 'Unreadable',
        tone: 'attention',
        subject: "Zomato's reply changed",
        spoken: 'Zomato changed something we do not understand',
      }
    case 'possible-duplicate-expense': {
      const sameDay = event.typed.businessDate === event.synced.businessDate
      const sameAmount = event.typed.amountPaise === event.synced.amountPaise
      return {
        tag: 'Twice?',
        tone: 'attention',
        // Two dates where they differ, because a match is not an exact match:
        // the owner dates a bill to when they noticed it and Zomato dates it to
        // the purchase. Showing one of the two would be picking a side.
        subject: sameDay
          ? shortDate(event.typed.businessDate)
          : `${shortDate(event.typed.businessDate)} / ${shortDate(event.synced.businessDate)}`,
        figure: sameAmount ? (
          <Money paise={event.synced.amountPaise} />
        ) : (
          <span className="whitespace-nowrap">
            <Money paise={event.typed.amountPaise} className="text-content-muted" />
            <span aria-hidden> / </span>
            <Money paise={event.synced.amountPaise} />
          </span>
        ),
        spoken: `${shortDate(event.synced.businessDate)} may be entered twice`,
      }
    }
  }
}

/**
 * Colour is never the only signal here, which is why every tag is a word first.
 * The tone only decides how loudly the word is said.
 */
const TONE_TAG: Record<Tone, string> = {
  quiet: 'bg-surface text-content-muted',
  attention: 'bg-warning/15 text-content',
  wrong: 'bg-danger/15 text-content',
}

interface SyncEventRowProps {
  row: AggregatorSyncEventRow
  busy: boolean
  onRecheck: (from: string, to: string) => void
  onAccept: (from: string, to: string) => void
  onReconnect: () => void
  onNotDuplicate: () => void
  /** Where this day lives in the ledger, so a flag can send you to it. */
  ledgerDayLink: (businessDate: string) => string
}

export function SyncEventRow({
  row,
  busy,
  onRecheck,
  onAccept,
  onReconnect,
  onNotDuplicate,
  ledgerDayLink,
}: SyncEventRowProps) {
  const actionable = needsOwner(row)
  const [open, setOpen] = useState(actionable)
  const [confirming, setConfirming] = useState(false)
  const line = lineFor(row.event)
  const resolved = row.resolvedAt !== null

  return (
    <Card className={cn('overflow-hidden p-0', actionable && 'border-danger/50')}>
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        aria-expanded={open}
        // Named explicitly. Read from its own content it would announce as a tag,
        // a date and a figure running into one another.
        aria-label={`${line.spoken}. ${open ? 'Hide' : 'Show'} the detail.`}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
      >
        <span
          className={cn(
            'w-[5.5rem] shrink-0 rounded px-1.5 py-0.5 text-center text-xs font-medium',
            resolved ? TONE_TAG.quiet : TONE_TAG[line.tone],
          )}
        >
          {line.tag}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-content">{line.subject}</span>
        {line.figure && <span className="shrink-0 text-sm text-content">{line.figure}</span>}
      </button>

      {open && (
        <div className="space-y-3 border-t border-border px-3 py-3 text-sm text-content-muted">
          {resolved && <p>Dealt with. Kept here so it can be found again.</p>}

          {row.event.kind === 'day-revised' && (
            <p>
              An order was cancelled after it was cooked. Zomato refunded us when the week paid.
            </p>
          )}

          {row.event.kind === 'week-settled' && <p>Matches what Zomato paid, to the paisa.</p>}

          {row.event.kind === 'days-written' && <p>Nothing needed from you.</p>}

          {row.event.kind === 'week-disputed' && (
            <WeekDisputed
              event={row.event}
              resolved={resolved}
              busy={busy}
              confirming={confirming}
              setConfirming={setConfirming}
              onRecheck={onRecheck}
              onAccept={onAccept}
            />
          )}

          {row.event.kind === 'session-lapsed' && (
            <>
              <p>Nothing was written while it was out, so no figure is wrong.</p>
              {!resolved && (
                <Button onClick={onReconnect} disabled={busy}>
                  Reconnect Zomato
                </Button>
              )}
            </>
          )}

          {row.event.kind === 'shape-changed' && (
            <p>Nothing was written. This one needs a developer, not you.</p>
          )}

          {row.event.kind === 'possible-duplicate-expense' && (
            <>
              {/*
                Side by side, in full. These two rows rarely agree exactly: a
                typed one comes off a paper bill or out of memory, so the amount
                may be rounded and the date may be when it was noticed. The
                owner can only judge whether they are the same purchase by
                seeing both, and the flag exists precisely because the app
                cannot judge it for them.
              */}
              <dl className="space-y-1">
                <Figure
                  label="You entered"
                  value={
                    <>
                      <Money paise={row.event.typed.amountPaise} />
                      <span className="text-content-muted">
                        {' '}
                        · {shortDate(row.event.typed.businessDate)} ·{' '}
                        {row.event.typed.note ?? 'no note'}
                      </span>
                    </>
                  }
                />
                <Figure
                  label="Zomato sent"
                  value={
                    <>
                      <Money paise={row.event.synced.amountPaise} />
                      <span className="text-content-muted">
                        {' '}
                        · {shortDate(row.event.synced.businessDate)} ·{' '}
                        {row.event.synced.note ?? 'no note'}
                      </span>
                    </>
                  }
                />
              </dl>
              {!resolved && (
                <>
                  <p>Both are counted at the moment.</p>
                  <div className="flex flex-wrap gap-2">
                    {/*
                      Withdrawing happens in the ledger rather than here, and the
                      link carries the day so it opens on it. Two lines of text
                      out of context is not enough to decide by, the row sits
                      among that day's other costs, and withdrawing cannot be
                      undone — it should be done looking at what it changes.
                    */}
                    <Link
                      to={ledgerDayLink(row.event.synced.businessDate)}
                      className={buttonVariants()}
                    >
                      Open {shortDate(row.event.synced.businessDate)} ledger
                    </Link>
                    <Button variant="secondary" onClick={onNotDuplicate} disabled={busy}>
                      Not a duplicate
                    </Button>
                  </div>
                </>
              )}
              {resolved && row.resolution === 'not-a-duplicate' && (
                <p>You said both are real, so this stopped asking.</p>
              )}
            </>
          )}
        </div>
      )}
    </Card>
  )
}

/** One labelled value. Wherever two figures have to be compared, they line up. */
function Figure({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="shrink-0">{label}</dt>
      <dd className="truncate text-right text-content">{value}</dd>
    </div>
  )
}

interface WeekDisputedProps {
  event: Extract<AggregatorSyncEvent, { kind: 'week-disputed' }>
  resolved: boolean
  busy: boolean
  confirming: boolean
  setConfirming: (value: boolean) => void
  onRecheck: (from: string, to: string) => void
  onAccept: (from: string, to: string) => void
}

/**
 * The one row that asks for a decision.
 *
 * There is no "approve", deliberately. Approving would mean writing figures
 * already known not to add up, which is the single thing the reconciliation gate
 * exists to prevent. Check again asks Zomato once more and clears most of these
 * without anybody deciding anything; accept writes the figures and records the
 * gap as its own visible line. Nothing here makes the difference disappear.
 */
function WeekDisputed({
  event,
  resolved,
  busy,
  confirming,
  setConfirming,
  onRecheck,
  onAccept,
}: WeekDisputedProps) {
  const gap = Math.abs(event.differencePaise)

  return (
    <div className="space-y-3">
      <dl className="space-y-1">
        <Figure label="Orders add up to" value={<Money paise={event.computedPaise} />} />
        <Figure label="Zomato paid" value={<Money paise={event.statedPayoutPaise} />} />
        <Figure
          label={event.differencePaise < 0 ? 'Paid more than counted' : 'Paid less than counted'}
          value={<Money paise={gap} className="font-medium text-danger" />}
        />
      </dl>

      {!resolved && (
        <>
          <p>Already paid, so it will not sort itself out. Nothing was written for it.</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => onRecheck(event.from, event.to)} disabled={busy}>
              Check again
            </Button>
            <Button variant="secondary" onClick={() => setConfirming(true)} disabled={busy}>
              Accept the difference
            </Button>
          </div>
        </>
      )}

      {/*
        A dialog rather than the row rearranging itself. Swapping the buttons out
        in place moves the decision to wherever the row happens to be sitting,
        which on a phone can be off screen, and it leaves the figures the
        decision is about still on the page competing for the same attention.
        The platform dialog also brings focus containment and Escape with it.
      */}
      <ConfirmDialog
        open={confirming}
        busy={busy}
        title="Accept the difference?"
        consequence={`Records ${formatPaise(gap)} as money we cannot explain, with your name on it. No day's figures change. Zomato's own numbers often move after a payout, so check again first.`}
        // The dialog recommends checking again, so it offers it. Telling
        // somebody to go and press a button they cannot see from here is how
        // they press this one instead.
        alternative={{
          label: 'Check again',
          onClick: () => {
            setConfirming(false)
            onRecheck(event.from, event.to)
          },
        }}
        confirmLabel="Record it as unexplained"
        onConfirm={() => {
          setConfirming(false)
          onAccept(event.from, event.to)
        }}
        onClose={() => setConfirming(false)}
      />
    </div>
  )
}
