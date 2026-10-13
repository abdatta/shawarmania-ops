import { STAGING_LABEL, STAGING_RIBBON_TEXT, type AppEnvironment } from '@/env/app-environment'
import { APP_ENVIRONMENT } from '@/env/current'

/**
 * The ribbon across the top-left corner of every screen of a staging build
 * (a-release-can-be-switched-off, D19): every shell, every role, signed in or
 * not, so a tablet at an outlet that somehow opened the staging address could
 * not mistake it for the counter. It has no close control and no prop that
 * hides it, and a production build renders nothing — the environment is fixed
 * at build time.
 *
 * **A corner ribbon, not a band** (owner, 2026-10-13, after using the band on
 * staging): a white row across the top of every screen was loud, and took a
 * row from every layout. The ribbon floats over the corner instead, in the
 * staging icon's blue, and lets every tap through, so nothing under it is
 * moved or blocked. It sits inside the safe area, so a phone's status bar
 * cannot cover it.
 *
 * The geometry is fixed so the whole ribbon stays inside the shortest top bar,
 * the phone shell's at 54px: the strip is 15px thick and its centre line
 * crosses the corner 41px out along each edge, so its outer edge reaches 52px
 * down the side and along the top. That leaves about 51px of strip at the
 * word's inner edge, and `STAGING` at 9.5px bold takes about 46. It never
 * wraps; it would clip first, and it does not reach the strip's ends.
 */
export function StagingRibbon({ environment = APP_ENVIRONMENT }: { environment?: AppEnvironment }) {
  if (environment !== 'staging') return null
  return (
    <div
      role="note"
      aria-label={STAGING_LABEL}
      data-testid="staging-ribbon"
      className="pointer-events-none fixed z-[1000] size-16 overflow-hidden"
      style={{ top: 'env(safe-area-inset-top, 0px)', left: 'env(safe-area-inset-left, 0px)' }}
    >
      <div
        aria-hidden
        className="absolute top-[13px] left-[-39.5px] flex h-[15px] w-[120px] -rotate-45 items-center justify-center whitespace-nowrap bg-staging-ribbon text-[9.5px] leading-none font-bold tracking-[0.05em] text-on-staging-ribbon uppercase shadow-md"
      >
        {STAGING_RIBBON_TEXT}
      </div>
    </div>
  )
}
