/**
 * The sender's own page on the laptop: what it is doing, and **Send batch**
 * (design D7).
 *
 * Releasing a batch happens here and nowhere else [owner, decision 5], which
 * is what makes "the owner is in the loop for every hundred" true. So this
 * server is guarded as the one place a press can start a hundred messages:
 *
 * - it listens on `127.0.0.1` only;
 * - it answers only requests addressed to itself by that name. A page on the
 *   internet that points a made-up domain name at 127.0.0.1 is refused;
 * - **Send batch** needs a token that exists only inside the page this server
 *   served, sent as a header. Another site open in the same browser can neither
 *   read the token nor send that header, so it cannot press the button;
 * - **its port is never the linking page's.** That page is sometimes put on a
 *   public address for a few minutes (`link-page-server.ts`); this one never.
 *
 * `GET /state` is the summary the tray icon and the pinned card are drawn
 * from. It carries no number and no message.
 *
 * `GET /history` is the history (`history.ts`), which carries customers' whole
 * numbers [owner, decision 17]. So it answers only the page's own token, as
 * Send batch does: no other site open in the same browser can read it.
 */

import { createServer } from 'node:http'
import type { IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'

/** Mirrored in the repository's `ports.ts` as `campaignSender`; a test holds the two together. */
export const CONTROL_PAGE_PORT = 7418

export interface ReleaseOutcome {
  ok: boolean
  /** One sentence for the person who pressed. */
  message: string
}

export interface ControlPageOptions {
  /** A secret made afresh for each run of the sender. */
  token: string
  /** The page itself, given the token to put inside it. */
  page: (token: string) => string
  /** The current summary, as plain data. */
  state: () => unknown
  /** The owner pressed Send batch. */
  onRelease: () => Promise<ReleaseOutcome>
  /** The history page's rows; absent for a sender that has none (a rehearsal). */
  history?: () => Promise<unknown>
  port?: number
}

export interface ControlPageServer {
  url: string
  close: () => Promise<void>
}

function addressedToUs(request: IncomingMessage, port: number): boolean {
  const host = request.headers.host
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`
}

/** Rejects when the port is taken: the sender is already running in another window. */
export function serveControlPage(options: ControlPageOptions): Promise<ControlPageServer> {
  let listening = 0
  const server = createServer((request, response) => {
    const send = (status: number, type: string, body: string) => {
      response.writeHead(status, {
        'content-type': `${type}; charset=utf-8`,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      })
      response.end(body)
    }

    if (!addressedToUs(request, listening)) return send(403, 'text/plain', 'Not for you.')

    if (request.method === 'GET' && request.url === '/') {
      return send(200, 'text/html', options.page(options.token))
    }
    if (request.method === 'GET' && request.url === '/state') {
      return send(200, 'application/json', JSON.stringify(options.state()))
    }
    if (request.method === 'GET' && request.url === '/history' && options.history) {
      if (request.headers['x-sender-token'] !== options.token) {
        return send(403, 'application/json', JSON.stringify({ message: 'Refused.' }))
      }
      options
        .history()
        .then((rows) => send(200, 'application/json', JSON.stringify(rows)))
        .catch(() => send(503, 'application/json', JSON.stringify({ message: 'Not now.' })))
      return
    }
    if (request.method === 'POST' && request.url === '/release') {
      if (request.headers['x-sender-token'] !== options.token) {
        return send(403, 'application/json', JSON.stringify({ ok: false, message: 'Refused.' }))
      }
      request.resume()
      options
        .onRelease()
        .catch((): ReleaseOutcome => ({ ok: false, message: 'Could not release the batch.' }))
        .then((outcome) =>
          send(outcome.ok ? 200 : 409, 'application/json', JSON.stringify(outcome)),
        )
      return
    }
    send(404, 'text/plain', 'Not found.')
  })

  return new Promise<ControlPageServer>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port ?? CONTROL_PAGE_PORT, '127.0.0.1', () => {
      listening = (server.address() as AddressInfo).port
      resolve({
        url: `http://127.0.0.1:${listening}`,
        close: () =>
          new Promise<void>((closed) => {
            server.close(() => closed())
            server.closeAllConnections()
          }),
      })
    })
  })
}
