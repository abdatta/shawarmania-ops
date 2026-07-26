/**
 * The identity of the running build, injected by Vite at build time.
 *
 * Load-bearing rather than decorative: the service worker caches the app
 * shell, so a bad deploy can persist on a tablet nobody has refreshed. This is
 * what makes "what build is that tablet on?" answerable over the phone instead
 * of by driving to the outlet.
 */
export const BUILD_SHA: string = __BUILD_SHA__
export const BUILD_TIME: string = __BUILD_TIME__
