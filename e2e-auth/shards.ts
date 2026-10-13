/**
 * How CI splits the auth suite across runners, each with its own fresh stack.
 *
 * Not Playwright's `--shard`: it divides by test count, and this suite's time is
 * in three tests. Measured on Staging run 38457964697 (13 October), gates off:
 * `request-budget` 110 s (its idle minute and windows are the measurement),
 * `billing-served` 103 s, `billing-offline` 82 s, and the other 38 tests 113 s
 * between them. So the heavy files are named, one runner each, and the last
 * shard runs every spec named nowhere here — a new spec file lands there
 * without anyone remembering to list it. Move a file into a named shard when
 * the last one grows past the slowest named one.
 *
 * `E2E_AUTH_SHARD=<n>/<total>` selects one; unset runs the whole suite, as
 * locally. `scripts/check-verify.test.mjs` holds the matrix in `verify.yml` to
 * this list.
 */
export const AUTH_SHARDS: readonly (readonly string[])[] = [
  ['request-budget.spec.ts'],
  ['billing-served.spec.ts'],
  ['billing-offline.spec.ts', 'kitchen-tablet.spec.ts'],
]

/** The named shards, then the one running everything else. */
export const AUTH_SHARD_TOTAL = AUTH_SHARDS.length + 1

/** Playwright's `testMatch`/`testIgnore` for one shard, or nothing for the whole suite. */
export function authShardFilter(
  value: string | undefined,
): { testMatch: string[] } | { testIgnore: string[] } | Record<string, never> {
  if (value === undefined || value === '') return {}
  const match = /^(\d+)\/(\d+)$/.exec(value)
  const shard = Number(match?.[1])
  const total = Number(match?.[2])
  if (!match || total !== AUTH_SHARD_TOTAL || shard < 1 || shard > total) {
    throw new Error(
      `E2E_AUTH_SHARD must be <n>/${AUTH_SHARD_TOTAL} (e2e-auth/shards.ts), not "${value}"`,
    )
  }
  const glob = (file: string) => `**/${file}`
  const named = AUTH_SHARDS[shard - 1]
  return named ? { testMatch: named.map(glob) } : { testIgnore: AUTH_SHARDS.flat().map(glob) }
}
