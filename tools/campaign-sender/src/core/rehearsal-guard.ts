/**
 * A rehearsal can reach exactly one phone.
 *
 * `npm run rehearse` runs the real sending loop over the real WhatsApp link,
 * from whatever account the laptop is linked to. This sits between the two and
 * lets a message go only to the one number the owner wrote down for
 * rehearsals. It does not trust the queue to have asked for the right number:
 * a hand-edited queue file, or a bug in the stand-in, still cannot message
 * anybody else.
 *
 * A second list of numbers may be *looked up* and never sent to. A rehearsal
 * uses it to see what WhatsApp answers for a number that is not on WhatsApp;
 * should such a number turn out to exist, the send is refused here.
 */

import { SendRefused } from './contracts.ts'
import type { LinkConnection, WhatsAppLink } from './contracts.ts'

export interface RehearsalReach {
  /** Digits with country code: the only number a message may go to. */
  recipient: string
  /** Numbers that may be asked about and never sent to. */
  lookupOnly?: readonly string[]
}

export function onlyTo(link: WhatsAppLink, reach: RehearsalReach): WhatsAppLink {
  const guard = (connection: LinkConnection): LinkConnection => {
    const sendable = new Set<string>()
    return {
      resolve: async (phoneDigits) => {
        if (phoneDigits === reach.recipient) {
          const address = await connection.resolve(phoneDigits)
          if (address) sendable.add(address)
          return address
        }
        if (reach.lookupOnly?.includes(phoneDigits)) return connection.resolve(phoneDigits)
        throw new Error('A rehearsal may look up only its own recipient.')
      },
      send: async (address, message) => {
        // Certain not to have gone, so the loop records it as failed, not unsure.
        if (!sendable.has(address)) throw new SendRefused('not_the_rehearsal_recipient')
        return connection.send(address, message)
      },
      onReceipt: (listener) => connection.onReceipt(listener),
      // A STOP is only passed on, never sent to.
      ...(connection.onStopReply
        ? {
            onStopReply: (listener: (phoneDigits: string) => void) =>
              connection.onStopReply?.(listener),
          }
        : {}),
    }
  }

  return {
    hold: (handlers, signal) =>
      link.hold(
        {
          onOpen: (connection) => handlers.onOpen(guard(connection)),
          onClose: () => handlers.onClose(),
        },
        signal,
      ),
  }
}
