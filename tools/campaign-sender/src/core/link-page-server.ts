/**
 * Serves the linking page on this laptop only (design D9).
 *
 * One page, at `/`, bound to `127.0.0.1`: nothing outside the laptop can reach
 * it unless the owner deliberately points a tunnel at it, which is how a QR
 * code is shown to somebody holding the phone in another country. The page is
 * whatever it was last told to show, so it holds a QR code only while one is
 * live.
 *
 * **It has a port of its own, and must keep it.** A tunnel makes the whole
 * port public for as long as it runs. The page where a batch is released
 * (design D7) is a different page on a different port, so that showing
 * somebody a QR code can never also show them a Send button.
 */

import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

/** Mirrored in the repository's `ports.ts` as `campaignSenderLink`; a test holds the two together. */
export const LINK_PAGE_PORT = 7417

export interface LinkPageServer {
  /** Where the page is, for a browser on this laptop. */
  url: string
  /** Replaces what the page shows. */
  show: (html: string) => void
  close: () => Promise<void>
}

/** Rejects when the port is taken, which means another sender window is already linking. */
export function serveLinkPage(
  initial: string,
  port: number = LINK_PAGE_PORT,
): Promise<LinkPageServer> {
  let html = initial
  const server = createServer((request, response) => {
    if (request.method !== 'GET' || request.url !== '/') {
      response.writeHead(404).end()
      return
    }
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      // A code is good for under a minute. Nothing may keep an old one.
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex',
    })
    response.end(html)
  })
  return new Promise<LinkPageServer>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      const { port: listening } = server.address() as AddressInfo
      resolve({
        url: `http://127.0.0.1:${listening}`,
        show: (next) => {
          html = next
        },
        close: () =>
          new Promise<void>((closed) => {
            server.close(() => closed())
            server.closeAllConnections()
          }),
      })
    })
  })
}
