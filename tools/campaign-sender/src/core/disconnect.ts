/**
 * What the sender does when its WhatsApp connection closes
 * (a-campaign-goes-out-on-whatsapp, design D10).
 *
 * Three answers and no others. **Halt** means stop and stay stopped until the
 * owner restarts the sender by hand: reconnecting an unofficial client that
 * WhatsApp has just refused is how a temporary restriction becomes a ban.
 * **Restart** is WhatsApp asking for a fresh connection, which it always does
 * straight after a device is linked. **Reconnect** is everything else — a
 * closed lid, lost Wi-Fi, a timeout — and is retried with growing waits.
 *
 * **The number alone cannot decide this, and reading it alone was a bug caught
 * in review before any phone was linked.** Baileys (7.0.0-rc14) reports 500 for
 * any failure it cannot name: a hotel Wi-Fi sign-in page answering the
 * connection, a wrong clock after waking, a TLS fault. It reports a proxy's
 * HTTP 403 as 403. Treating those as WhatsApp's verdict would halt a healthy
 * link and tell the owner to unlink it. So the decision is taken on **who
 * said it**, read from the wording Baileys gives each origin:
 *
 *   `Connection Failure`   WhatsApp refused the login itself
 *   `Stream Errored (…)`   WhatsApp ended a connection that was up
 *   anything else          the network, the socket or a timer: never a halt
 *
 * This module imports nothing, so the root test run covers it without
 * WhatsApp installed.
 */

export type DisconnectAction = 'halt' | 'restart' | 'reconnect'

export type HaltReason =
  | 'logged_out'
  | 'forbidden'
  | 'refused'
  | 'multidevice_mismatch'
  | 'replaced'
  | 'restricted'
  | 'unreadable_record'

export interface DisconnectDecision {
  action: DisconnectAction
  /** Set only when `action` is `halt`. */
  haltReason?: HaltReason
}

export interface Disconnect {
  statusCode: number | undefined
  /** The error's message as Baileys worded it. Says who closed the connection. */
  message: string | undefined
}

const RECONNECT: DisconnectDecision = { action: 'reconnect' }
const halt = (haltReason: HaltReason): DisconnectDecision => ({ action: 'halt', haltReason })

/** WhatsApp's answer to a client version it no longer accepts. Handled by the caller. */
export const VERSION_REFUSED = 405

/**
 * WhatsApp's answer to a message from an account it has restricted from
 * starting new chats. Baileys words it, in its own source, as "usually" that:
 * it can also mean one contact's privacy token is missing. A campaign is
 * nothing but new chats, and Baileys' note beside it says a retry "counts as
 * another reach out and worsens the restriction", so the sender does not wait
 * to find out which.
 */
export const MESSAGE_REFUSED_AS_RESTRICTED = '463'

/**
 * Not a close WhatsApp made: the sender's own, when WhatsApp says the account
 * is restricted (its `reachoutTimeLock` notice, or the refusal above) while
 * the connection stays up. Worded so that it reads as a third origin.
 */
export const RESTRICTED: Disconnect = { statusCode: 463, message: 'Account Restricted' }

export function classifyDisconnect({ statusCode, message }: Disconnect): DisconnectDecision {
  const said = message ?? ''

  if (said.startsWith('Account Restricted')) return halt('restricted')

  // WhatsApp refused the login. A 4xx is a decision about this device or
  // account, so the sender stops; a 5xx is WhatsApp having a bad moment.
  if (said.startsWith('Connection Failure')) {
    if (statusCode === 401) return halt('logged_out')
    if (statusCode === 403) return halt('forbidden')
    if (statusCode === VERSION_REFUSED) return RECONNECT
    if (statusCode !== undefined && statusCode >= 400 && statusCode < 500) return halt('refused')
    return RECONNECT
  }

  // WhatsApp ended a connection that was up.
  if (said.startsWith('Stream Errored')) {
    if (statusCode === 515) return { action: 'restart' }
    if (statusCode === 401) return halt('logged_out')
    if (statusCode === 403) return halt('forbidden')
    // Another program opened a connection with this device's login. Two
    // senders reconnect each other forever, so this one stands down.
    if (statusCode === 440) return halt('replaced')
    return RECONNECT
  }

  if (said.startsWith('Multi-device beta not joined')) return halt('multidevice_mismatch')
  if (said.startsWith('Intentional Logout')) return halt('logged_out')

  return RECONNECT
}

const CHECK_THE_PHONE =
  'On the phone, open WhatsApp → Linked devices. If this laptop is still listed, the link is intact: run npm run restart. Only if it is gone does it need unlinking and linking again.'

/** What the owner is told, in the terminal now and on the sender's page later. */
export const HALT_EXPLANATIONS: Readonly<Record<HaltReason, string>> = {
  logged_out: `WhatsApp says this device was logged out. ${CHECK_THE_PHONE}`,
  forbidden:
    'WhatsApp refused the account. Open WhatsApp on the phone and read what it says there before anything else. Do not reconnect until it is clear.',
  refused: `WhatsApp refused this device’s login. Open WhatsApp on the phone first and read anything it says about the account. ${CHECK_THE_PHONE}`,
  multidevice_mismatch: `WhatsApp says this login does not match the account’s linked devices. ${CHECK_THE_PHONE}`,
  replaced:
    'Another program connected with this sender’s login. Only one sender may run at a time. Close the other one, then run npm run restart. The link itself is intact.',
  restricted:
    'WhatsApp says this account is restricted, or refused a message in the way it does for a restricted account. Open WhatsApp on the phone and read what it says there. Send nothing from this account by any means, and do not run npm run restart, until the phone shows no restriction. The link itself is intact.',
  unreadable_record:
    'The sender was halted earlier, and the note saying why cannot be read. Open WhatsApp on the phone and check the account and Linked devices before running npm run restart.',
}
