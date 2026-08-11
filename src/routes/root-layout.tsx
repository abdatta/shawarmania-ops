import { Outlet } from 'react-router'

import { BuildVersion } from '@/components/build-version'
import { AppAction } from '@/components/app-action'
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
          <AppAction />
          <ThemeToggle />
        </div>
      </header>

      {/*
        A flex column so a screen inside it can fill and centre. `flex-1` alone
        gives `main` a used height but leaves its CSS height `auto`, so a child's
        `min-h-full` resolved to nothing and the entry cards sat at the top of a
        tall viewport. A screen that wants centring now adds `flex-1` and centres
        within it; one that does not is unaffected
        (the-root-resolves-instead-of-greeting, design D9).
      */}
      <main className="flex flex-1 flex-col px-4 py-6">
        <Outlet />
      </main>

      <footer className="border-t border-border px-4 py-3 text-center">
        <BuildVersion />
      </footer>
    </div>
  )
}
