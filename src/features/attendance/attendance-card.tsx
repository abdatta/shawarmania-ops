import { ChevronDown } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'

import { Card } from '@/components/ui/card'
import { cn } from '@/lib/cn'

/**
 * One day, as a headline you can open.
 *
 * Every attendance row used to render all of its evidence, all of the time. On a
 * roll-call of eight people that is right for the two rows a manager came to
 * decide and wrong for the six they are scanning past — and this screen is only
 * ever held on a phone. So a row collapses to its first line, which is who (or
 * when) and what the day counts as, and opens onto the evidence, the approval
 * note and the actions.
 *
 * **A row waiting for a manager opens by default.** It is the one row carrying
 * somebody else's request for attention, it already has the warning border and
 * is already sorted to the top, and putting `Approve` behind a chevron would add
 * a tap in front of the only thing this screen exists for.
 *
 * **Open state belongs to the reader, not to the row.** It is seeded once and
 * never recomputed, so approving a day leaves it open showing what just
 * happened rather than folding away under the thumb that pressed it — the same
 * reasoning that keeps the sort order still while the view is open.
 *
 * **A row with nothing beneath it gets no toggle at all.** A chevron that
 * promises something and opens onto nothing is worse than no chevron, so `Not
 * yet arrived` and `Working at another outlet` render as headlines and stop
 * there.
 *
 * **A pinned row cannot be closed, and still shows its chevron.** Every control
 * that decides a roll-call row lives in the panel, so a closed one is a row a
 * manager can neither act on nor tell apart from one they have already put in a
 * set. The chevron stays rendered and goes inert rather than disappearing, so
 * the headline does not shift sideways at the moment the row settles and the
 * chevron becomes live again — the same stillness the sort order keeps.
 *
 * **A derived absence is not one of those rows.** It has no evidence, no
 * approval and no action, but it does have a cause, and an absence that cannot
 * account for itself is the verdict somebody is most likely to argue with. So it
 * opens onto that one sentence and nothing else.
 *
 * The header is the WAI-ARIA accordion shape — a button inside the heading — so
 * the heading survives, which is how a roll-call is navigable at all.
 *
 * Shared by the roll-call and by the range list for the same reason the evidence
 * components are shared: an employee must see exactly what their manager sees,
 * and two implementations of "open this day" would drift apart.
 */
export function AttendanceCard({
  testId,
  toggleTestId,
  heading: Heading = 'h2',
  title,
  verdict,
  details,
  waiting,
  defaultOpen = false,
  pinnedOpen = false,
}: {
  testId: string
  /** The chevron's own id, so a test can open a row without guessing its name. */
  toggleTestId: string
  heading?: 'h2' | 'h3'
  /** The headline: a person's name, or a date. */
  title: ReactNode
  /** What the day counts as. Read beside the headline, open or closed. */
  verdict: ReactNode
  /** Everything behind the chevron. Null when there is genuinely nothing. */
  details: ReactNode | null
  /** Waiting for a manager — the warning border, and the reason to open. */
  waiting: boolean
  defaultOpen?: boolean
  /**
   * Held open, with the toggle inert. Passed by the roll-call for a row waiting
   * on a manager, never derived here from `waiting`: the by-staff month list
   * shares this card and an employee reads their own month through it, where a
   * waiting day carries no action at all and pinning it would only lengthen a
   * thirty-day list.
   */
  pinnedOpen?: boolean
}) {
  const panelId = useId()
  const [openState, setOpen] = useState(defaultOpen)
  const open = pinnedOpen || openState

  const row = 'flex w-full flex-wrap items-baseline justify-between gap-x-2 gap-y-1 text-left'

  return (
    <Card
      data-testid={testId}
      className={waiting ? 'space-y-1.5 p-3 border-warning' : 'space-y-1.5 p-3'}
    >
      <Heading className="text-sm font-bold text-content">
        {details === null ? (
          <span className={row}>
            {title}
            <span className="text-sm font-normal">{verdict}</span>
          </span>
        ) : (
          <button
            type="button"
            data-testid={toggleTestId}
            aria-expanded={open}
            aria-controls={panelId}
            disabled={pinnedOpen}
            onClick={() => setOpen((current) => !current)}
            className={`${row} rounded focus-visible:focus-ring disabled:cursor-default`}
          >
            {title}
            <span className="inline-flex items-center gap-1.5 text-sm font-normal">
              {verdict}
              <ChevronDown
                aria-hidden
                size={14}
                className={cn(
                  'shrink-0 text-content-muted transition-transform',
                  open && 'rotate-180',
                  // Occupies the same space either way, so settling a row moves
                  // nothing; it only stops looking like something to press.
                  pinnedOpen && 'opacity-40',
                )}
              />
            </span>
          </button>
        )}
      </Heading>

      {details !== null && open && (
        <div id={panelId} className="space-y-1.5">
          {details}
        </div>
      )}
    </Card>
  )
}
