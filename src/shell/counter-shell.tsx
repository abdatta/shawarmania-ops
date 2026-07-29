import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, Outlet } from 'react-router'

import { ThemeToggle } from '@/components/theme-toggle'
import { useAdapters } from '@/data-access/adapters-context'
import { ShiftStatus, SyncIndicator } from '@/features/billing/counter-status'
import { visibleSurfaces } from '@/gates/registry'
import { cn } from '@/lib/cn'
import { useSession } from '@/session/context'
import { ROLE_SEGMENTS } from '@/session/session'

/**
 * The Biller shell: landscape tablet, fixed chrome, nothing that scrolls
 * unexpectedly. The header carries the outlet name, who is on shift, the state
 * of the queue, the theme toggle, the account menu when a real session filled
 * that slot, and — in demo mode — the banner strip via the other, slim so it
 * can never occlude billing actions.
 *
 * Navigation is in that same header rather than in tabs down the side, and it is
 * derived from the gate registry exactly as the phone shell's is — so a surface
 * this role has no entry for is absent rather than greyed out. Until this change
 * the biller had one surface and needed none; a shift screen that can only be
 * reached by typing a URL is not reachable.
 *
 * The shift and sync indicators read the billing adapter for themselves rather
 * than taking props, so this shell stays mode-agnostic: it renders whatever the
 * adapter it was handed reports, and never asks which one it got.
 */
export function CounterShell({
  banner,
  accountMenu,
}: {
  banner?: ReactNode
  accountMenu?: ReactNode
}) {
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

  const base =
    session.mode === 'demo' ? `/demo/${ROLE_SEGMENTS.biller}` : `/${ROLE_SEGMENTS.biller}`
  const items = visibleSurfaces(session.role, session.mode)

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-canvas text-content">
      {banner}
      {/*
        Wraps rather than truncates. The counter's device is a landscape tablet
        and everything fits on one line there — but the shell still has to be
        usable on a phone, and a header that shrinks its own shift status to
        nothing has hidden the one fact a biller needs to check.
      */}
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-surface px-4 py-2">
        <span className="font-display text-lg tracking-wide text-accent-text">Shawarmania</span>
        <span className="truncate text-sm font-semibold">{outletName ?? '—'}</span>

        <nav aria-label="Primary" className="flex items-center gap-1">
          {items.map((surface) => {
            const Icon = surface.nav?.icon
            return (
              <NavLink
                key={surface.id}
                to={surface.path === '' ? base : `${base}/${surface.path}`}
                end={surface.path === ''}
                className={({ isActive }) =>
                  cn(
                    'flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold',
                    'focus-visible:focus-ring',
                    isActive
                      ? 'bg-surface-raised text-accent-text'
                      : 'text-content-muted hover:bg-surface-raised hover:text-content',
                  )
                }
              >
                {Icon && <Icon aria-hidden size={16} />}
                {surface.nav?.label}
              </NavLink>
            )
          })}
        </nav>

        <ShiftStatus />
        <span className="ml-auto">
          <SyncIndicator />
        </span>
        <ThemeToggle />
        {accountMenu}
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto p-4">
        <Outlet />
      </main>
    </div>
  )
}
