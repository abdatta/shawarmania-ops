/**
 * The link an admin sends instead of dictating a code.
 *
 * Built from the running deployment's own origin and Vite's base, so the same
 * code produces the right URL under the GitHub Pages sub-path today and under
 * a custom domain later, with nothing to remember at the cutover.
 *
 * Identity data is deliberately absent. The code already identifies the
 * account, and the URL should not put a username into browser history, link
 * previews, or proxies.
 */
export function activationLink(
  code: string,
  origin: string = typeof window === 'undefined' ? '' : window.location.origin,
  base: string = import.meta.env.BASE_URL,
): string {
  // BASE_URL is '/' at the root and '/shawarmania-ops/' under a sub-path, both
  // with a trailing slash; normalising anyway keeps a hand-set BASE_PATH from
  // producing a double slash or a missing one.
  const path = `/${base}/activate`.replace(/\/{2,}/g, '/')
  return `${origin}${path}?code=${encodeURIComponent(code)}`
}
