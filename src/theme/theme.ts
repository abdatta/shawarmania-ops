/**
 * Theme resolution and persistence.
 *
 * The *initial* resolution happens in an inline script in index.html, before
 * first paint — React mounts far too late to prevent a flash of the wrong
 * theme on a dark phone at night. This module owns everything after that:
 * reading the current state, toggling it, and persisting the choice.
 */

/** Must stay in sync with the inline script in index.html. */
export const THEME_STORAGE_KEY = 'shawarmania.theme'

export type Theme = 'light' | 'dark'

function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark'
}

/** The user's explicit choice, or `undefined` if they have never chosen. */
export function getStoredTheme(): Theme | undefined {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    return isTheme(stored) ? stored : undefined
  } catch {
    // Private browsing, or storage disabled. Fall back to the device.
    return undefined
  }
}

/** What the device prefers right now. */
export function getDeviceTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** The theme currently applied to the document. */
export function getActiveTheme(): Theme {
  const applied = document.documentElement.dataset['theme']
  return isTheme(applied) ? applied : (getStoredTheme() ?? getDeviceTheme())
}

/**
 * Apply a theme and remember it. The choice persists across reloads and app
 * restarts — a manager who prefers dark should not re-choose every morning.
 */
export function setTheme(theme: Theme): void {
  document.documentElement.dataset['theme'] = theme
  syncThemeColorMeta()
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // Storage unavailable: the theme still applies for this session.
  }
  notify()
}

export function toggleTheme(): Theme {
  const next: Theme = getActiveTheme() === 'dark' ? 'light' : 'dark'
  setTheme(next)
  return next
}

/**
 * Keep the browser chrome colour matching the canvas.
 *
 * Set from the computed token rather than a literal, so the value cannot drift
 * from the design system — and so no hex has to live outside tokens.css.
 */
export function syncThemeColorMeta(): void {
  const canvas = getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim()
  if (!canvas) return

  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (!meta) {
    meta = document.createElement('meta')
    meta.name = 'theme-color'
    document.head.appendChild(meta)
  }
  meta.content = canvas
}

/**
 * The theme is external state — it lives on the document element, set before
 * React exists — so components read it through `useSyncExternalStore` rather
 * than mirroring it into component state. `subscribe` is the store's other
 * half; `getActiveTheme` is its snapshot.
 */
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

/**
 * Subscribe to theme changes, from the toggle or from the device.
 *
 * Following the device only applies while the user has made no explicit
 * choice, so an app left open across sunset matches the phone it runs on.
 */
export function subscribeToTheme(onChange: () => void): () => void {
  listeners.add(onChange)

  const query = window.matchMedia('(prefers-color-scheme: dark)')
  const onDeviceChange = (event: MediaQueryListEvent) => {
    if (getStoredTheme()) return
    document.documentElement.dataset['theme'] = event.matches ? 'dark' : 'light'
    syncThemeColorMeta()
    notify()
  }
  query.addEventListener('change', onDeviceChange)

  return () => {
    listeners.delete(onChange)
    query.removeEventListener('change', onDeviceChange)
  }
}
