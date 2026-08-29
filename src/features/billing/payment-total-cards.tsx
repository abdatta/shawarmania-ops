import { useCallback, useEffect, useRef, type RefCallback } from 'react'

import { Money } from '@/components/ui/money'
import { BILLING_PAYMENT_METHODS, type BillingMethodTotal } from '@/data-access/adapters'

function methodLabel(method: BillingMethodTotal['method']) {
  return method === 'upi' ? 'UPI' : method[0]!.toUpperCase() + method.slice(1)
}

/**
 * The figure's two sizes: the display face it has everywhere else in the app,
 * and the label above it — the point below which a figure stops being the thing
 * the card is about.
 */
const FIGURE_CEILING = '1.5rem'
const FIGURE_FLOOR = '0.875rem'

/**
 * Keep a money figure at full size until its card cannot hold it, then shrink it
 * exactly as far as it must and no further.
 *
 * **Why this is measured rather than computed.** The obvious version sizes the
 * figure from the card's width and the number of characters, and it is wrong by
 * five to fifteen pixels: `Lilita One` is proportional, so `₹3,711` and `₹5,483`
 * are different widths at the same size and the same character count. Guessing
 * from a count leaves a gap on the right that the padding on the left does not
 * have, which is the whole complaint this solves.
 *
 * Text width is linear in font size, so one measurement is the whole answer: set
 * the ceiling, ask how wide the figure actually is, and keep the ratio of the
 * space it has to the space it wanted. `max()` puts the floor in CSS rather than
 * arithmetic here, so the two caps stay next to each other and in `rem`.
 *
 * The span is a block filling the card's content box, so its own width is the
 * space available and changing the font inside it cannot change that — which is
 * what makes observing it for resizes safe rather than a loop. Where there is no
 * layout to measure at all (jsdom under test), it leaves the ceiling alone.
 */
function useFittedFigure(enabled: boolean, text: string): RefCallback<HTMLSpanElement> {
  const figureRef = useRef<HTMLSpanElement | null>(null)

  const fit = useCallback(() => {
    const figure = figureRef.current
    if (!figure) return

    if (!enabled) {
      figure.style.fontSize = ''
      return
    }

    figure.style.fontSize = FIGURE_CEILING
    // No layout to measure — jsdom under test, or an element not yet laid out.
    // The ceiling is already set, which is the right answer wherever it fits.
    const available = figure.clientWidth
    if (!available) return

    const range = document.createRange()
    range.selectNodeContents(figure)
    if (typeof range.getBoundingClientRect !== 'function') return
    const wanted = range.getBoundingClientRect().width
    if (!wanted) return

    // One pixel held back, so an exact fit stays a fit when a different device
    // rounds the glyph advances a hair the other way.
    const ratio = Math.min(1, (available - 1) / wanted)
    figure.style.fontSize = `max(${FIGURE_FLOOR}, calc(${FIGURE_CEILING} * ${ratio.toFixed(4)}))`
  }, [enabled])

  // The figure itself changes when the day does, and the space it has changes
  // when the window does. Both are the same question asked again.
  useEffect(() => {
    fit()
    if (!enabled || typeof ResizeObserver === 'undefined') return
    const figure = figureRef.current
    if (!figure) return
    const observer = new ResizeObserver(fit)
    observer.observe(figure)
    return () => observer.disconnect()
  }, [enabled, fit, text])

  return useCallback(
    (node: HTMLSpanElement | null) => {
      figureRef.current = node
      fit()
    },
    [fit],
  )
}

/**
 * One money figure, named. The card is the presentation both scopes share, so
 * the tender split and anything shown beside it are the same object on screen —
 * same uniform padding, same label, same border, same height, same alignment.
 *
 * `tight` is what lets four of these sit across a phone, and it changes one
 * thing: the figure is fitted rather than fixed. A card is about 82px there,
 * which holds `₹500` at full size and not `₹609.22`, and shrinking both to suit
 * the longer one would make the day's takings smaller than they need to be on
 * the card beside it. Each figure gets the largest size that leaves its padding
 * even on both sides, so on any card wide enough — every card from about 120px
 * up, which is every tablet and desktop — nothing shrinks at all.
 *
 * Nothing else moves: still left aligned, still `p-3`, and the line box is
 * pinned at the display face's own height so the card is exactly as tall as the
 * two-column card whatever size the figure settles on.
 */
function TotalCard({
  label,
  paise,
  testId,
  tight,
}: {
  label: string
  paise: number
  testId: string
  tight: boolean
}) {
  const fitRef = useFittedFigure(tight, `${paise}`)

  return (
    <div data-testid={testId} className="rounded-xl border border-border bg-surface p-3">
      <p className="text-sm font-black uppercase text-content-muted">{label}</p>
      <Money
        ref={fitRef}
        paise={paise}
        display={!tight}
        className={tight ? 'mt-1 block font-display leading-[2rem]' : 'mt-1 block'}
      />
    </div>
  )
}

/**
 * Cash and UPI always use the same compact, glanceable cards wherever billing
 * payment totals are shown. The caller decides the scope of the supplied totals
 * (current shift or selected outlet day) and names its test boundary.
 *
 * A caller may add cards after the tender split — the manager's outlet-day view
 * adds the day's takings and its average order value. They are `further` cards
 * rather than a second component because they are the same reading of the same
 * day at the same glance, and a differently shaped card beside these two would
 * say they were something else. Their arithmetic is not this component's
 * business: see `day-totals.ts`, which owns it and is tested on its own.
 *
 * `dense` changes the column count and nothing else. The manager's day puts all
 * four in one row because they are read together — takings against tender
 * against average — and a row that wraps makes the reader's eye work out which
 * card belongs to which line. The counter's shift rail has two figures and its
 * own vertical room, so it keeps two per row. The cards themselves are identical
 * either way: a figure that shrank because of what sits beside it would say the
 * scope mattered less, and it does not.
 */
export function PaymentTotalCards({
  totals,
  testIdPrefix,
  further = [],
  dense = false,
}: {
  totals: readonly BillingMethodTotal[]
  testIdPrefix: string
  further?: readonly { label: string; paise: number; testId: string }[]
  dense?: boolean
}) {
  return (
    <div className={`grid gap-2 ${dense ? 'grid-cols-4' : 'grid-cols-2'}`}>
      {BILLING_PAYMENT_METHODS.map((paymentMethod) => (
        <TotalCard
          key={paymentMethod}
          label={methodLabel(paymentMethod)}
          paise={totals.find((total) => total.method === paymentMethod)?.totalPaise ?? 0}
          testId={`${testIdPrefix}-${paymentMethod}`}
          tight={dense}
        />
      ))}
      {further.map((card) => (
        <TotalCard
          key={card.testId}
          label={card.label}
          paise={card.paise}
          testId={card.testId}
          tight={dense}
        />
      ))}
    </div>
  )
}
