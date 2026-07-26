# Workbox Build-Chain Advisories

**Type**: Investigation · **Status**: Open, accepted for now · **Area**: Build tooling

## Expectation

`npm audit` is clean, so a genuinely new advisory is visible rather than buried in known noise.

## Current behaviour

Eight high-severity advisories are reported, all on one transitive chain from a single direct
dependency:

`vite-plugin-pwa` → `workbox-build` → `rollup-plugin-off-main-thread` → `ejs` → `jake` →
`filelist` → `minimatch` → `brace-expansion`

No fixed version of `workbox-build` was available when `project-foundations` landed, so
`npm audit fix` cannot resolve them without removing the PWA plugin.

## Why it is accepted for now

The chain is entirely build-time. `workbox-build` runs during `npm run build` to generate the
service worker; none of it is bundled or shipped to a browser. The vulnerable behaviour is template
rendering and glob expansion over inputs that come from our own committed config, not from user
data or the network.

That reasoning holds only while the chain stays build-time. If any of these packages ever appears
in the client bundle, this stops being acceptable immediately.

## What to do

- Re-check after each `vite-plugin-pwa` release; the fix will arrive as a `workbox-build` bump.
- If it stays unfixed long enough to matter, evaluate generating the service worker directly with
  Workbox's own CLI, or hand-writing a minimal precache worker — the app shell is small and the
  precache manifest is the only part that genuinely needs generating.

## Trigger to promote

A fixed `workbox-build` ships (then it is a one-line dependency bump, no change folder needed), or
an advisory appears on this chain that is reachable at runtime rather than build time.
