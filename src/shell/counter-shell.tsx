import { useEffect, useState, type ReactNode } from 'react'
import { Outlet } from 'react-router'

import { ThemeToggle } from '@/components/theme-toggle'
import { useAdapters } from '@/data-access/adapters-context'
import { useSession } from '@/session/context'

/**
 * The Biller shell: landscape tablet, fixed chrome, nothing that scrolls
 * unexpectedly. The header carries the outlet name, the shift and sync
 * placeholders (filled by ui-billing-counter and counter-devices-and-offline
 * respectively), the theme toggle, and — in demo mode — the banner strip via
 * the slot, slim so it can never occlude billing actions.
 */
export function CounterShell({ banner }: { banner?: ReactNode }) {
  const session = useSession()
  const { outlets } = useAdapters()
  const [outletName, setOutletName] = useState<string>()

  useEffect(() => {
    if (!session.outletId) return
    let active = true
    void outlets.getOutlet(session.outletId).then((outlet) => {
      if (active) setOutletName(outlet?.name)
    })
    return () => {
      active = false
    }
  }, [outlets, session.outletId])

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-canvas text-content">
      {banner}
      <header className="flex items-center gap-4 border-b border-border bg-surface px-4 py-2">
        <span className="font-display text-lg tracking-wide text-accent-text">Shawarmania</span>
        <span className="truncate text-sm font-semibold">{outletName ?? '—'}</span>
        <span className="text-xs text-content-muted" data-testid="shift-status">
          No shift open
        </span>
        <span
          className="ml-auto flex items-center gap-1.5 text-xs text-content-muted"
          data-testid="sync-indicator"
        >
          <span aria-hidden className="size-2 rounded-full bg-success" />
          synced
        </span>
        <ThemeToggle />
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto p-4">
        <Outlet />
      </main>
    </div>
  )
}
