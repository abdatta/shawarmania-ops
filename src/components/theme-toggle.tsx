import { Moon, Sun } from 'lucide-react'
import { useSyncExternalStore } from 'react'

import { Button } from '@/components/ui/button'
import { getActiveTheme, subscribeToTheme, toggleTheme } from '@/theme/theme'

/**
 * Reachable from every screen, per docs/DESIGN_SYSTEM.md.
 *
 * The theme is read straight from the document rather than mirrored into
 * component state: it is set before React mounts, and a second copy of it
 * could disagree with what is actually on screen.
 */
export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribeToTheme, getActiveTheme, () => 'light' as const)
  const next = theme === 'dark' ? 'light' : 'dark'

  return (
    <Button
      variant="ghost"
      size="phone"
      aria-label={`Switch to ${next} theme`}
      onClick={() => toggleTheme()}
    >
      {theme === 'dark' ? <Moon aria-hidden size={18} /> : <Sun aria-hidden size={18} />}
      <span className="sr-only sm:not-sr-only">{theme === 'dark' ? 'Dark' : 'Light'}</span>
    </Button>
  )
}
