import type { ReactNode } from 'react'
import { NavLink, Outlet } from 'react-router'

import { ThemeToggle } from '@/components/theme-toggle'
import { NavAttentionBadge } from '@/features/attention/nav-badge'
import { visibleSurfaces, type Surface } from '@/gates/registry'
import { cn } from '@/lib/cn'
import { useSession } from '@/session/context'
import {
  personalHeldRoles,
  personalNavigationRoles,
  ROLE_SEGMENTS,
  type Role,
} from '@/session/session'

/**
 * The shell for the phone-first roles — Super Admin, Franchise Admin,
 * Employee. Bottom tabs on phone widths (one-handed reach, always-visible
 * state), a left rail on wider screens; both render the same registry-derived
 * entries. Mode-agnostic by design (spec: a uniform session context serves
 * real and demo modes): the demo tree passes its banner through one slot, the
 * real tree passes its account menu through the other, and nothing here
 * branches on mode beyond deriving the role's base path.
 */
export function PhoneShell({
  banner,
  accountMenu,
  appAction,
}: {
  banner?: ReactNode
  accountMenu?: ReactNode
  appAction?: ReactNode
}) {
  const session = useSession()
  // Every role the person can reach, not just the one whose shell they are in:
  // a manager who also grills at the other outlet reaches both sets of surfaces
  // without switching anything (multi-outlet-people, design D6), and the owner
  // reaches the outlet-level surfaces holding no assignment at all
  // (owner-reaches-every-outlet, design D1). What they HOLD still decides which
  // homes are theirs.
  const held = personalHeldRoles(session)
  const items = visibleSurfaces(personalNavigationRoles(session), session.mode, held)
  const home = held[0]

  const baseFor = (role: Role) => {
    const segment = ROLE_SEGMENTS[role]
    return session.mode === 'demo' ? `/demo/${segment}` : `/${segment}`
  }

  /**
   * A navigation entry stays **inside the shell you are in** (design D1a): the
   * owner's Attendance is `/owner/attendance`, not `/admin/attendance`. Every
   * role branch mounts the same surface routes, and the gate resolves a path
   * against the roles the session can reach, so the surface is the same either
   * way — what differs is that one address keeps the reader where they are and
   * the other reads as though they had become somebody else. In demo mode it is
   * not merely cosmetic: the role lives in the URL there, so a link into another
   * role's segment would swap the persona mid-walk. The counter shell has always
   * done it this way; this is the phone shell agreeing with it.
   *
   * A home is the exception, because two of them cannot share one address: an
   * index surface keeps its own role's segment. Only a role the person holds
   * contributes one, so both addresses are always theirs.
   */
  const linkFor = (surface: Surface) => {
    const base = baseFor(surface.path === '' ? surface.role : (home ?? surface.role))
    return surface.path === '' ? base : `${base}/${surface.path}`
  }

  /**
   * Whether an entry stops claiming its own sub-paths: **the most specific
   * navigation entry wins, and only it.**
   *
   * `NavLink` matches by prefix unless told otherwise, which is right for a
   * surface whose sub-paths belong to it — Delivery stays lit on one channel's
   * page, because `ledger/delivery/:channel` is Delivery. It is wrong the
   * moment a sub-path has a navigation entry of its own: `ledger/expenses` is
   * not the Ledger, and lighting both told the reader they were in two places.
   *
   * Derived from the entries themselves rather than declared per surface, so the
   * next nested entry cannot forget to do it.
   */
  const claimedByAChild = (path: string) =>
    path !== '' && items.some((other) => other.path.startsWith(`${path}/`))

  /** The navigation entry this one lives under, if any. */
  const parentOf = (surface: Surface) =>
    items.find((other) => other.path !== '' && surface.path.startsWith(`${other.path}/`))

  /**
   * Entries with each nested one directly beneath its parent.
   *
   * Sorted here rather than left to the registry's `order` numbers lining up by
   * luck. A child that drifted three entries away from its parent would still be
   * indented, and an indent pointing at the wrong thing above it is worse than
   * no indent at all.
   */
  const railItems = items
    .filter((surface) => !parentOf(surface))
    .flatMap((parent) => [parent, ...items.filter((child) => parentOf(child)?.id === parent.id)])

  return (
    <div className="flex min-h-dvh flex-col bg-canvas text-content">
      {banner}
      <header className="flex items-center justify-between gap-3 border-b border-border bg-surface px-4 py-2">
        <div className="min-w-0">
          <span className="block font-display text-lg leading-tight tracking-wide text-accent-text">
            Shawarmania Ops
          </span>
          <span className="block truncate text-xs text-content-muted">{session.displayName}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {appAction}
          <ThemeToggle />
          {accountMenu}
        </div>
      </header>

      <div className="flex flex-1">
        <nav
          aria-label="Primary"
          className="hidden border-r border-border p-3 md:flex md:w-48 md:flex-col md:gap-1"
        >
          {railItems.map((surface) => {
            const Icon = surface.nav?.icon
            // Indented, and hung off a rule that runs down beside it. Two
            // signals rather than one, because an indent alone reads as a
            // rendering accident at this scale.
            const nested = parentOf(surface) !== undefined
            return (
              <NavLink
                key={surface.id}
                to={linkFor(surface)}
                end={surface.path === '' || claimedByAChild(surface.path)}
                className={({ isActive }) =>
                  cn(
                    'flex h-[var(--size-control-phone)] items-center gap-2 rounded-lg px-3 text-sm font-semibold',
                    'focus-visible:focus-ring',
                    nested && 'ml-3 border-l border-border pl-4',
                    isActive
                      ? 'bg-surface-raised text-accent-text'
                      : 'text-content-muted hover:bg-surface-raised hover:text-content',
                  )
                }
              >
                {Icon && <Icon aria-hidden size={18} />}
                {surface.nav?.label}
                {surface.nav?.attention && (
                  <span className="ml-auto">
                    <NavAttentionBadge
                      key={surface.nav.attention}
                      source={surface.nav.attention}
                      surface={surface.nav.label}
                    />
                  </span>
                )}
              </NavLink>
            )
          })}
        </nav>

        <main className="min-w-0 flex-1 px-4 py-5 pb-24 md:pb-6">
          <Outlet />
        </main>
      </div>

      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 flex overflow-x-auto border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {items.map((surface) => {
          const Icon = surface.nav?.icon
          return (
            <NavLink
              key={surface.id}
              to={linkFor(surface)}
              // No indenting is possible in a row of tabs, so the single
              // highlight carries the whole answer here.
              end={surface.path === '' || claimedByAChild(surface.path)}
              className={({ isActive }) =>
                cn(
                  'flex h-16 min-w-[4.5rem] flex-1 shrink-0 flex-col items-center justify-center gap-1 px-1 text-center text-xs font-semibold',
                  'focus-visible:focus-ring',
                  isActive ? 'text-accent-text' : 'text-content-muted',
                )
              }
            >
              {/*
                The badge sits on the corner of the icon here rather than after
                the label: a bottom tab is a stack, and a number on the end of
                the word would push the tab wider than its neighbours.
              */}
              <span className="relative">
                {Icon && <Icon aria-hidden size={20} />}
                {surface.nav?.attention && (
                  <span className="absolute -right-2.5 -top-1.5">
                    <NavAttentionBadge
                      key={surface.nav.attention}
                      source={surface.nav.attention}
                      surface={surface.nav.label}
                    />
                  </span>
                )}
              </span>
              {surface.nav?.label}
            </NavLink>
          )
        })}
      </nav>
    </div>
  )
}
