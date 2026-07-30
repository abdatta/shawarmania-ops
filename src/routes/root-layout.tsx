import { Outlet } from 'react-router'

import { BuildVersion } from '@/components/build-version'
import { InstallAppButton } from '@/components/install-app-button'
import { ThemeToggle } from '@/components/theme-toggle'

/**
 * The shell every role eventually mounts inside.
 *
 * Deliberately role-agnostic for now: the role-aware navigation and route sets
 * arrive with demo-mode-and-app-shell (#3), once there is an auth claim and a
 * gate registry to drive them.
 */
export function RootLayout() {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas text-content">
      <header className="flex items-center justify-between border-b border-border bg-surface px-4 py-3">
        <span className="font-display text-xl tracking-wide text-accent-text">Shawarmania Ops</span>
        <div className="flex items-center gap-2">
          <InstallAppButton />
          <ThemeToggle />
        </div>
      </header>

      <main className="flex-1 px-4 py-6">
        <Outlet />
      </main>

      <footer className="border-t border-border px-4 py-3 text-center">
        <BuildVersion />
      </footer>
    </div>
  )
}
