/**
 * This app's own ports — `7412`–`7416`, reserved as a block.
 *
 * **Vite's defaults are not usable on a machine with more than one Vite app.**
 * Dev defaults to 5173 and preview to 4173, and on a collision Vite silently
 * walks upward: 5174, 5175, and on. This laptop had 5173, 5174 *and* 5175
 * listening at once when this file was written, which is the failure in full —
 * the app's address becomes whichever port was free at the time, so a bookmark,
 * an OAuth redirect and `supabase/config.toml`'s `site_url` can all point at
 * whichever project happened to start first.
 *
 * `strictPort` therefore accompanies every one of these. Without it the block
 * would defeat itself: a busy 7412 would walk into 7413 and collide with
 * preview. **Failing loudly is the whole point.**
 *
 * 7412 is the first four digits of Kalyani's PIN code (741235), which makes the
 * block this project's rather than arbitrary. It sits clear of every dev-tool
 * default — 3000, 4000, 4173/4174, 4200, 5000, 5173–5175, 5432, 5500, 8000,
 * 8080, 8888, 9000, and Supabase's local 54321–54324 — and below the ephemeral
 * range Windows allocates from (49152+), so the OS will never hand one of these
 * out to something else.
 *
 * Its own module rather than a constant in `vite.config.ts`, because the
 * Playwright configs need it too and importing the Vite config would pull in
 * every plugin and shell out to `git` just to read a number.
 *
 * **The five are separate on purpose.** See `playwright.auth.config.ts` on why
 * sharing a port between a preview left open and a suite that must rebuild
 * produces a test result that depends on what ran before it.
 *
 * `.claude/launch.json` carries three of these as literals, because JSON cannot
 * import. It is the one place that has to be edited alongside this file.
 */
export const PORTS = {
  /** `npm run dev`. */
  dev: 7412,
  /** `npm run preview` — a human looking at a production build. */
  preview: 7413,
  /** A second preview, for holding two builds side by side. */
  previewAlt: 7414,
  /** The demo E2E suite (`playwright.config.ts`). */
  e2e: 7415,
  /** The auth E2E suite (`playwright.auth.config.ts`), which needs a real backend. */
  e2eAuth: 7416,
} as const

/**
 * Where the demo E2E suite's preview server answers.
 *
 * Exported for the `baseURL ?? …` fallbacks in `e2e/`, which Playwright never
 * actually reaches — it always supplies `baseURL` from the config. They are
 * imported rather than written out because a stale literal there is worse than
 * dead: several of those lines feed the tripwire asserting that **no request
 * leaves the app's own origin**, and a fallback pointing at the wrong port would
 * make that assertion pass while testing nothing.
 */
export const E2E_ORIGIN = `http://127.0.0.1:${PORTS.e2e}`
