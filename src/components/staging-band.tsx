import { STAGING_BAND_TEXT, type AppEnvironment } from '@/env/app-environment'
import { APP_ENVIRONMENT } from '@/env/current'

/**
 * The band across the top of every screen of a staging build
 * (a-release-can-be-switched-off, D19): every shell, every role, signed in or
 * not. A tablet at an outlet that somehow opened the staging address could not
 * mistake it for the counter. It has no close control and no prop that hides it,
 * and a production build renders nothing — the environment is fixed at build time.
 *
 * It sits in the page's flow above the router; `index.css` takes its height off
 * every full-height layout in a staging build, so no screen is pushed below the
 * fold by it.
 */
export function StagingBand({ environment = APP_ENVIRONMENT }: { environment?: AppEnvironment }) {
  if (environment !== 'staging') return null
  return (
    <div
      role="status"
      data-testid="staging-band"
      className="flex h-6 shrink-0 items-center justify-center bg-content text-xs font-semibold tracking-wide text-canvas"
    >
      {STAGING_BAND_TEXT}
    </div>
  )
}
