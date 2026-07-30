import type { ReactNode } from 'react'
import { NavLink, Outlet } from 'react-router'

import { ThemeToggle } from '@/components/theme-toggle'
import { visibleSurfaces, type Surface } from '@/gates/registry'
import { cn } from '@/lib/cn'
import { useSession } from '@/session/context'
import { heldRoles, ROLE_SEGMENTS, type Role } from '@/session/session'

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
  installAction,
}: {
  banner?: ReactNode
  accountMenu?: ReactNode
  installAction?: ReactNode
}) {
  const session = useSession()
  // Every role the person holds, not just the one whose shell they are in: a
  // manager who also grills at the other outlet reaches both sets of surfaces
  // without switching anything (multi-outlet-people, design D6).
  const items = visibleSurfaces(heldRoles(session), session.mode)

  const baseFor = (role: Role) => {
    const segment = ROLE_SEGMENTS[role]
    return session.mode === 'demo' ? `/demo/${segment}` : `/${segment}`
  }

  const linkFor = (surface: Surface) => {
    const base = baseFor(surface.role)
    return surface.path === '' ? base : `${base}/${surface.path}`
  }

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
          {installAction}
          <ThemeToggle />
          {accountMenu}
        </div>
      </header>

      <div className="flex flex-1">
        <nav
          aria-label="Primary"
          className="hidden border-r border-border p-3 md:flex md:w-48 md:flex-col md:gap-1"
        >
          {items.map((surface) => {
            const Icon = surface.nav?.icon
            return (
              <NavLink
                key={surface.id}
                to={linkFor(surface)}
                end={surface.path === ''}
                className={({ isActive }) =>
                  cn(
                    'flex h-[var(--size-control-phone)] items-center gap-2 rounded-lg px-3 text-sm font-semibold',
                    'focus-visible:focus-ring',
                    isActive
                      ? 'bg-surface-raised text-accent-text'
                      : 'text-content-muted hover:bg-surface-raised hover:text-content',
                  )
                }
              >
                {Icon && <Icon aria-hidden size={18} />}
                {surface.nav?.label}
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
              end={surface.path === ''}
              className={({ isActive }) =>
                cn(
                  'flex h-16 min-w-[4.5rem] flex-1 shrink-0 flex-col items-center justify-center gap-1 px-1 text-center text-xs font-semibold',
                  'focus-visible:focus-ring',
                  isActive ? 'text-accent-text' : 'text-content-muted',
                )
              }
            >
              {Icon && <Icon aria-hidden size={20} />}
              {surface.nav?.label}
            </NavLink>
          )
        })}
      </nav>
    </div>
  )
}
