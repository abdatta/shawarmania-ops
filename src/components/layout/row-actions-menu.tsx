import { EllipsisVertical } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'

export interface RowAction {
  label: string
  onSelect: () => void
  disabled?: boolean
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
 */
export function RowActionsMenu({ label, actions }: { label: string; actions: RowAction[] }) {
  const detailsRef = useRef<HTMLDetailsElement>(null)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<{ top: number; right: number } | null>(null)

  useEffect(() => {
    if (!open) return

    function place() {
      const rect = detailsRef.current?.getBoundingClientRect()
      if (rect) setPosition({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
    }
    place()

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      setOpen(false)
      detailsRef.current?.querySelector('summary')?.focus()
    }
    function onPointerDown(event: PointerEvent) {
      if (!detailsRef.current?.contains(event.target as Node)) setOpen(false)
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
  }, [open])

  return (
    <details
      ref={detailsRef}
      open={open}
      className="inline-block"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary
        role="button"
        aria-label={label}
        className="flex size-[var(--size-control-phone)] cursor-pointer list-none items-center justify-center rounded-lg text-content-muted hover:bg-surface-raised hover:text-content focus-visible:focus-ring [&::-webkit-details-marker]:hidden"
      >
        <EllipsisVertical aria-hidden size={18} />
      </summary>

      {open && position && (
        <div
          style={{ position: 'fixed', top: position.top, right: position.right }}
          className="z-30 flex min-w-40 flex-col gap-0.5 rounded-lg border border-border bg-surface p-1 shadow-lg"
        >
          {actions.map((action) => (
            <Button
              key={action.label}
              variant="ghost"
              size="phone"
              className="w-full justify-start"
              disabled={action.disabled}
              onClick={() => {
                setOpen(false)
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
