import { Check, CircleAlert } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { cn } from '@/lib/cn'

/** How long a toast is readable, then how long its fade-out runs. */
const SHOWN_MS = 6000
const FADE_MS = 400

export interface ToastMessage {
  text: string
  /** Offered for as long as the toast shows, as Team's Deactivate does. */
  undo?: () => void
  /** `done` (the default) for something that went through; `warning` for one that did not. */
  tone?: 'done' | 'warning'
}

interface ShownToast extends ToastMessage {
  /** Fading out: kept on screen for the length of its fade, then gone. */
  leaving: boolean
}

/**
 * The app's toast: what just happened, said where the thumb is.
 *
 * A page owns its toast — `const toast = useToast()`, then `toast.show({ text })`
 * and `<Toast toast={toast.current} />` anywhere in the page — so it needs no
 * provider and a test renders it with the page. Showing another replaces the
 * one up; each lasts six seconds and fades in and out as an Android toast does.
 * First built for Team (owner, demo review of #82); shared from #46.
 */
export function useToast() {
  const [current, setCurrent] = useState<ShownToast | null>(null)
  const text = current?.text ?? null
  const undo = current?.undo

  useEffect(() => {
    if (text === null) return
    const fade = window.setTimeout(
      () => setCurrent((shown) => shown && { ...shown, leaving: true }),
      SHOWN_MS,
    )
    const gone = window.setTimeout(() => setCurrent(null), SHOWN_MS + FADE_MS)
    return () => {
      window.clearTimeout(fade)
      window.clearTimeout(gone)
    }
  }, [text, undo])

  const show = useCallback((message: ToastMessage) => {
    setCurrent({ ...message, leaving: false })
  }, [])
  const clear = useCallback(() => setCurrent(null), [])

  return { current, show, clear }
}

/**
 * A small pill above the tab bar on a phone, at the foot of the window wider
 * up: as wide as what it says, in the accent, as an Android toast is (owner,
 * demo review of #82), so it never reads as part of the bar. `testId` names it
 * for tests; its Undo is `${testId}-undo`.
 */
export function Toast({
  toast,
  busy = false,
  testId = 'toast',
}: {
  toast: ShownToast | null
  /** Disables Undo while the page is already doing something. */
  busy?: boolean
  testId?: string
}) {
  if (!toast) return null
  const warning = toast.tone === 'warning'
  const Icon = warning ? CircleAlert : Check
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(156px+env(safe-area-inset-bottom))] z-40 flex justify-center px-4 md:bottom-6">
      <div
        key={toast.text}
        role="status"
        data-testid={testId}
        data-tone={toast.tone ?? 'done'}
        className={cn(
          toast.leaving ? 'toast-out' : 'toast-in',
          'pointer-events-auto inline-flex max-w-full items-center gap-2 rounded-full py-1.5 pl-3 pr-1.5 text-xs font-semibold shadow-md',
          warning ? 'bg-warning text-on-warning' : 'bg-primary/75 text-on-primary',
        )}
      >
        <Icon aria-hidden size={14} className="shrink-0 opacity-80" />
        <span className="min-w-0 opacity-90">{toast.text}</span>
        {toast.undo && (
          <button
            type="button"
            data-testid={`${testId}-undo`}
            disabled={busy}
            onClick={toast.undo}
            className="rounded-full px-2.5 py-1 font-bold uppercase tracking-wide hover:bg-on-primary/15 focus-visible:focus-ring disabled:opacity-60"
          >
            Undo
          </button>
        )}
      </div>
    </div>
  )
}
