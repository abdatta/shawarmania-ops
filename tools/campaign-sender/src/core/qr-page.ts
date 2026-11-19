/**
 * The page a QR code is shown on while linking (design D9).
 *
 * WhatsApp replaces a QR code every 20 to 60 seconds, so a picture of one is
 * stale before anybody far away can open it. The sender instead serves this
 * page (`link-page-server.ts`), changes it each time the code changes, and the
 * page reloads itself: whoever is looking at it, on this screen or through a
 * tunnel to it, always sees the code that works now.
 *
 * **Whoever scans the code links their own WhatsApp account to this laptop.**
 * The page is therefore shown only to the person holding the phone, and is
 * replaced by `linkedPage` the moment a link is made.
 *
 * Text in, text out: nothing here draws the code or touches a file.
 */

const RELOAD_SECONDS = 2

function page(body: string, reload: boolean): string {
  return `<!doctype html><meta charset="utf-8">${reload ? `<meta http-equiv="refresh" content="${RELOAD_SECONDS}">` : ''}
<title>Link WhatsApp</title>
<meta name="robots" content="noindex">
<style>
  body { margin: 0; background: #fff; color: #111; font: 20px/1.4 system-ui, sans-serif; text-align: center; }
  svg { width: min(78vmin, 720px); height: auto; display: block; margin: 12px auto; }
  p { margin: 12px 16px; }
</style>
${body}
`
}

/** @param svg the QR code, already drawn. @param shownAt a clock time to print under it. */
export function qrPage(svg: string, nth: number, shownAt: string): string {
  return page(
    `<p><b>On the phone:</b> WhatsApp → Linked devices → Link a device → point the camera here.</p>
${svg}
<p>Code ${nth}, shown ${shownAt}. It changes by itself; this page keeps up.</p>`,
    true,
  )
}

/** Shown until the first code arrives, and between attempts. */
export function waitingPage(): string {
  return page(
    '<p style="margin-top:30vh">No code is showing right now. One will appear here by itself.</p>',
    true,
  )
}

/** Shown once the link is made. It holds no code and does not reload. */
export function linkedPage(): string {
  return page('<p style="margin-top:30vh"><b>Linked.</b> This page can be closed.</p>', false)
}
