import { EllipsisVertical } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'

export interface RowAction {
  label: string
  onSelect: () => void
  disabled?: boolean
  /** For callers whose tests reach the action by name rather than by its label. */
  testId?: string
}

/**
 * A kebab menu for a table row's actions, so a row with several actions stays
 * one tap wide instead of forcing the whole table wider (and into horizontal
 * scroll) for every row.
 *
 * The panel is `position: fixed`, computed from the trigger's own rect,
 * rather than `absolute`. DataTable's wrapper sets `overflow-x-auto`, and per
 * the CSS overflow spec a non-`visible` `overflow-x` forces `overflow-y` to
 * `auto` as well — an `absolute` panel opening below the last row would be
 * clipped by the table's own box exactly where it most needs to open.
 *
 * Native `<details>`/`<summary>` for the disclosure itself, same as
 * AccountMenu: less to get subtly wrong than a hand-built popover.
 *
 * **The element is left uncontrolled, deliberately.** It used to carry
 * `open={open}` beside an `onToggle` that set that same state, which is a race
 * rather than a redundancy: the browser flips `details.open` itself on a click
 * and *then* fires `toggle`, so between the two there is a window in which
 * React's last committed prop still says `false`. Any render landing in that
 * window writes `false` back over the browser's `true` and the menu shuts as
 * it opens. It is rare, load-dependent and it did bite — the component's own
 * tests failed intermittently under a full suite, on both opening and closing.
 *
 * So the element owns whether it is open, `onToggle` reports that upward for
 * the panel to render against, and the two paths that close it from outside a
 * click — Escape, and a pointer landing elsewhere — set `details.open`
 * directly. React never writes the attribute, so there is nothing to race.
 */
export function RowActionsMenu({
  label,
  actions,
  compact = false,
  align = 'end',
}: {
  label: string
  actions: RowAction[]
  /**
   * Trims the trigger to the glyph plus a hair, for lists whose row is itself
   * one tap target. A full 44px control is the right size when the kebab is the
   * only thing on the row to hit; where the whole card already takes the tap it
   * is mostly padding, and padding on every row is what makes a list feel long.
   */
  compact?: boolean
  /** Which trigger edge the menu's matching edge should use. */
  align?: 'start' | 'end'
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<{
    top: number
    left?: number
    right?: number
  } | null>(null)

  /** Shut it the way the element itself does, so `toggle` reports it upward. */
  function close() {
    const details = detailsRef.current
    if (details) details.open = false
    else setOpen(false)
  }

  useEffect(() => {
    if (!open) return

    function place() {
      const rect = detailsRef.current?.getBoundingClientRect()
      if (!rect) return

      setPosition(
        align === 'start'
          ? { top: rect.bottom + 4, left: rect.left }
          : { top: rect.bottom + 4, right: window.innerWidth - rect.right },
      )
    }
    place()

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      // Focus first, then close: the panel is about to leave the document, and
      // if the reader had tabbed into it their focus would go with it.
      detailsRef.current?.querySelector('summary')?.focus()
      close()
    }
    function onPointerDown(event: PointerEvent) {
      if (!detailsRef.current?.contains(event.target as Node)) close()
    }

    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [align, open])

  return (
    <details
      ref={detailsRef}
      className="inline-block"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary
        role="button"
        aria-label={label}
        className={`flex cursor-pointer list-none items-center justify-center rounded-lg text-content-muted hover:bg-surface-raised hover:text-content focus-visible:focus-ring [&::-webkit-details-marker]:hidden ${
          compact ? 'size-8' : 'size-[var(--size-control-phone)]'
        }`}
      >
        <EllipsisVertical aria-hidden size={compact ? 16 : 18} />
      </summary>

      {open && position && (
        <div
          style={{ position: 'fixed', ...position }}
          className="z-30 flex min-w-40 flex-col gap-0.5 rounded-lg border border-border bg-surface p-1 shadow-lg"
        >
          {actions.map((action) => (
            <Button
              key={action.label}
              variant="ghost"
              size="phone"
              className="w-full justify-start"
              data-testid={action.testId}
              disabled={action.disabled}
              onClick={() => {
                close()
                action.onSelect()
              }}
            >
              {action.label}
            </Button>
          ))}
        </div>
      )}
    </details>
  )
}
