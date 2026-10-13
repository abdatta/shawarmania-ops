/**
 * Which deployment a build is for (a-release-can-be-switched-off, D19).
 *
 * Decided at build time by `VITE_APP_ENVIRONMENT`, and only `staging` means
 * anything: every other value, and none, is production. So a production build
 * cannot drift into staging by a missing variable, and staging is never a
 * runtime state a page could enter — it is a different build of the same code,
 * published to a different address, against a different project.
 *
 * Kept free of `import.meta` so `vite.config.ts` can name the manifest with it.
 */

export type AppEnvironment = 'production' | 'staging'

export function parseAppEnvironment(value: string | undefined): AppEnvironment {
  return value === 'staging' ? 'staging' : 'production'
}

/** What an installed app is called, so a staging install cannot pass for the counter's. */
export function manifestNames(environment: AppEnvironment): { name: string; short_name: string } {
  return environment === 'staging'
    ? { name: 'Shawarmania Ops (staging)', short_name: 'Staging' }
    : { name: 'Shawarmania Ops', short_name: 'Shawarmania' }
}

export const STAGING_BAND_TEXT = 'Staging · not a real outlet'
