import { useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { cn } from '@/lib/cn'

/**
 * The reasoning behind a figure, one tap away instead of always on screen.
 *
 * **The problem this solves.** These surfaces have a lot to explain — why a
 * broken opening chain is reported rather than repaired, why a spend stays out
 * of the month, why every count time is approximate. Every one of those
 * sentences is worth keeping and none of them is worth reading twice. Rendered
 * inline they turned the drawer into a page of warning-coloured paragraphs,
 * which is how a reader learns to skip the paragraph that matters.
 *
 * **Rewritten 2026-08-29, and the shape it replaced is worth naming.** This used
 * to be a separate ⓘ button standing beside the chip it explained, which
 * expanded a paragraph *in place*. Two things were wrong with that, and the
 * owner hit both at once: a row of chips each trailing its own little icon reads
 * as clutter rather than as an offer, and expanding in place shoved everything
 * below it down the screen — so on a balance card with three explainable chips,
 * opening one moved the figures the reader was looking at.
 *
 * So now **the chip is the button**, and the explanation opens as a small modal
 * over the surface. Nothing reflows, the top layer means no ancestor's
 * `overflow` can clip it, and Escape, focus containment and backdrop dismissal
 * come from `<dialog>` rather than from code here.
 *
 * **What must NOT go behind it.** Anything the reader has to see before acting:
 * the difference on a count, and the alert that a minus means money going in.
 * Those are not explanations, they are the content — and hiding a safety warning
 * behind a tap is worse than a wall of text, because a wall of text can at least
 * be read by accident.
 *
 * **The affordance is a dotted underline**, the same convention an abbreviation
 * has carried for thirty years, plus `cursor-help`. A chip that explains itself
 * has to look different from one that does not, or the offer is a secret.
 *
 * Accessible by construction: a real `<button>` whose accessible name is the
 * chip's own text followed by what pressing it explains, so a screen reader
 * hears the fact first and the offer second rather than losing the fact to an
 * `aria-label`.
 */
export function Explain({
  label,
  children,
  explanation,
  className,
  ...rest
}: {
  /** What this explains, as a phrase: "why this is not repaired". */
  label: string
  /** The trigger — usually a `Chip`, sometimes a run of text. */
  children: ReactNode
  explanation: ReactNode
  className?: string
} & { 'data-testid'?: string }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'inline-flex cursor-help items-center rounded-full',
          'underline decoration-dotted underline-offset-4',
          'focus-visible:focus-ring',
          className,
        )}
        {...rest}
      >
        {children}
        {/*
          The fact is the visible name; this says what the tap will do.

          It opens on a comma rather than a space, because the accessible-name
          algorithm trims each node before joining them: a leading space is
          dropped and the two run together. A comma survives and reads as the
          pause it is.
        */}
        <span className="sr-only">, explain: {label}</span>
      </button>

      {/*
        Portalled to the body, because a trigger belongs wherever the fact it
        explains happens to sit — and several of them sit inside a `<p>`, which
        may not contain a `<dialog>`. Rendering in place produced invalid
        nesting the first time this shipped. The dialog is in the top layer once
        it opens either way, so where it lives in the DOM costs nothing and this
        keeps the component droppable anywhere.
      */}
      {createPortal(
        <Modal
          open={open}
          onClose={() => setOpen(false)}
          aria-label={label}
          // `inset-0` with `m-auto` is the one centring a dialog gets right in
          // both directions without arithmetic. The first attempt pinned
          // `inset-x-4` and translated, which does NOT centre: with both `left`
          // and `right` set, a box narrower than the gap between them stays at
          // `left` — so on a phone it sat against the left edge, which is where
          // the owner found it. `h-fit` keeps it the height of its own words
          // rather than the height of the viewport.
          className="fixed inset-0 m-auto h-fit w-[calc(100%-2rem)] max-w-sm rounded-xl p-4"
        >
          <div className="space-y-3">
            <p className="text-sm text-content">{explanation}</p>
            <Button
              size="phone"
              variant="secondary"
              className="w-full"
              onClick={() => setOpen(false)}
              data-testid="explain-close"
            >
              Got it
            </Button>
          </div>
        </Modal>,
        document.body,
      )}
    </>
  )
}
