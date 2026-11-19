/**
 * The WhatsApp side of the sender: a linked-device connection through Baileys
 * (a-campaign-goes-out-on-whatsapp, design D3, D9, D10, D11).
 *
 * **A connection sends only for a caller that asks for a `Session`.** `link`
 * and `start` do not, so the device can sit linked with no send call reachable
 * and nothing listening. `test-send` asks for one, and so does the sending
 * loop, which reaches this file only as the `WhatsAppLink` that `whatsAppLink`
 * returns (`core/contracts.ts`). No handler reads an incoming message: the only
 * message event listened to is the status of messages this laptop sent.
 *
 * Nothing CI runs imports this file. The decisions it acts on live in `core/`,
 * which the root test run covers with no WhatsApp installed.
 *
 * Baileys as found (7.0.0-rc14), where it differs from older write-ups:
 *
 * - A completed link is `creds.account`, which only a successful link sets.
 *   `creds.registered` and `creds.me` can both be written earlier.
 * - **Linking is by QR code only.** A pairing code typed on the phone was the
 *   first way built, because the phone is in another country. It linked the
 *   owner's own number, then was refused every time on the business number
 *   (2026-11-18), and a QR code shown through a tunnel linked it on the first
 *   scan. The pairing-code path is gone (design D9).
 * - Every attempt to link starts from an empty login, and a refusal while
 *   linking is a failed attempt, never a halt. A login left by an abandoned
 *   attempt would be sent as a *login*, which WhatsApp refuses.
 * - WhatsApp always closes with 515 straight after a link and expects a
 *   reconnect.
 * - The login is kept in memory across reconnects and saved through
 *   `core/creds-file.ts`; it is not re-read from disk between connections,
 *   because the save of a just-completed link can still be in flight. Baileys'
 *   own `saveCreds` is never called, so nothing else writes `creds.json`.
 * - History sync is left at Baileys' default (everything but the full
 *   history). Turning it off entirely stops Baileys learning the account's
 *   LID mappings, which it warns leads to session errors. Nothing here listens
 *   for what arrives, so it is dropped unread and unstored (D11).
 * - `sendMessage` returns as soon as the message is written to the socket. It
 *   does not wait for WhatsApp's answer. A refusal comes afterwards, as a
 *   status of 0 on the message with WhatsApp's code beside it; here that is
 *   the receipt `rejected`.
 * - A restriction does not close the connection. It arrives as
 *   `reachoutTimeLock` on a connection update, or as code 463 on a refused
 *   message. Either halts the sender (D10), by the sender closing the
 *   connection itself.
 */

import {
  Browsers,
  BufferJSON,
  fetchLatestWaWebVersion,
  makeWASocket,
  useMultiFileAuthState as loadAuthState,
} from 'baileys'
import type { AuthenticationState, WAVersion } from 'baileys'
import pino from 'pino'

import { reconnectDelayMs } from './core/backoff.ts'
import { SendRefused } from './core/contracts.ts'
import type {
  LinkConnection,
  LinkEnd,
  OutgoingMessage,
  ReceiptListener,
  ReceiptStatus,
  WhatsAppLink,
} from './core/contracts.ts'
import {
  backUpCreds,
  forgetLogin,
  restoreCredsIfBroken,
  writeCredsAtomically,
} from './core/creds-file.ts'
import { authFolder, writeHalt } from './core/data-folder.ts'
import { isLidJid, isStopReply, phoneOfJid, senderPhone } from './core/stop-reply.ts'
import {
  classifyDisconnect,
  MESSAGE_REFUSED_AS_RESTRICTED,
  RESTRICTED,
  VERSION_REFUSED,
} from './core/disconnect.ts'
import type { Disconnect, HaltReason } from './core/disconnect.ts'

export interface LinkEvents {
  /**
   * The text of a QR code to show whoever holds the phone. WhatsApp replaces
   * it every 20 to 60 seconds, so this is called again with each new one.
   */
  onQr?: (qr: string) => void
  onOnline: (ownJid: string) => void
  onOffline: (retryInMs: number, statusCode: number | undefined) => void
  /** One plain line worth telling the person at the laptop. */
  onNote: (line: string) => void
}

export type LinkOutcome =
  | { kind: 'halted'; reason: HaltReason }
  | { kind: 'not_linked' }
  | { kind: 'pairing_gave_up' }
  | { kind: 'pairing_refused'; statusCode: number | undefined }
  | { kind: 'outdated' }
  | { kind: 'stopped' }

export interface LinkOptions {
  dataFolder: string
  /**
   * Link this laptop: the phone scans the QR codes `events.onQr` is given.
   * Given only when linking; absent when holding a link already made.
   */
  linkByQr?: boolean
  events: LinkEvents
  signal: AbortSignal
  /**
   * Called each time a connection opens, with the means to send over it. A
   * caller that gives no `onSession` gets a connection that cannot send and
   * listens for nothing, which is what `link` and `start` are.
   */
  onSession?: (session: Session) => void
  /** Called when the connection last given to `onSession` is gone. */
  onSessionClosed?: () => void
}

/**
 * One open connection, seen as the three things a campaign needs from it. The
 * shape is `LinkConnection`, declared with the loop that uses it.
 */
export type Session = LinkConnection
export type { OutgoingMessage, ReceiptStatus }

// `proto.WebMessageInfo.Status`, as numbers: 0 is an error, 3 is delivered,
// 4 read, 5 played. 1 and 2 are the laptop's and the server's own progress.
const STATUS_ERROR = 0
const STATUS_DELIVERED = 3
const STATUS_READ = 4

/**
 * `CAMPAIGN_SENDER_TRACE=receipts` prints one line per status event WhatsApp
 * sends: the last four characters of a message id, and numbers. Never content,
 * never a phone number. For finding out why a receipt was not counted.
 */
const TRACE_RECEIPTS = process.env['CAMPAIGN_SENDER_TRACE'] === 'receipts'

/**
 * How many times one `link` run asks WhatsApp for a fresh set of QR codes
 * before asking the owner to start again. A set lasts about two and a half
 * minutes, so this is about twenty: the first link across two countries took
 * eight.
 */
const MAX_PAIRING_ATTEMPTS = 8

/**
 * A connection has to stay up this long before the next drop is treated as a
 * fresh problem. Without it, a login that WhatsApp accepts and then closes a
 * moment later would be retried every two seconds for ever.
 */
const SETTLED_AFTER_MS = 60_000

/** WhatsApp asking for a fresh connection, back to back, more often than this is not that. */
const MAX_IMMEDIATE_RESTARTS = 3

const VERSION_LOOKUP_TIMEOUT_MS = 15_000

type Closed = Disconnect & { onlineForMs: number; opened: boolean }

// Baileys logs message metadata at its chattier levels. Silent, always: the
// sender prints its own few lines and never a number or a message (D11).
const quiet = pino({ level: 'silent' })

interface Login {
  state: AuthenticationState
  /** Queues an atomic save of the login as it stands now. */
  save: () => void
  /** Resolves when every queued save has reached the disk, retrying one that failed. */
  flush: () => Promise<void>
}

async function openLogin(dataFolder: string, onNote: (line: string) => void): Promise<Login> {
  const folder = authFolder(dataFolder)
  if (restoreCredsIfBroken(folder) === 'restored') {
    onNote('The saved login was damaged and has been restored from its backup.')
  }
  const { state } = await loadAuthState(folder)
  let pending: Promise<void> = Promise.resolve()
  let unsaved = false
  let warned = false

  const write = () => {
    // Serialised at the moment of writing, so the file holds the newest login.
    try {
      writeCredsAtomically(folder, JSON.stringify(state.creds, BufferJSON.replacer))
      unsaved = false
    } catch {
      unsaved = true
      if (!warned) {
        warned = true
        onNote('Could not save the login to disk just now. It will be tried again.')
      }
    }
  }

  return {
    state,
    save: () => {
      pending = pending.then(write)
    },
    flush: () => {
      pending = pending.then(() => {
        if (unsaved) write()
      })
      return pending
    },
  }
}

async function latestVersion(): Promise<WAVersion | undefined> {
  const latest = await fetchLatestWaWebVersion({
    signal: AbortSignal.timeout(VERSION_LOOKUP_TIMEOUT_MS),
  }).catch(() => undefined)
  return latest?.isLatest ? latest.version : undefined
}

/**
 * Connects and stays connected until halted, stopped, or found unlinked.
 * Resolves; it never throws for a dropped connection.
 */
export async function holdLink(options: LinkOptions): Promise<LinkOutcome> {
  const { events, signal, dataFolder } = options
  const pairing = Boolean(options.linkByQr)
  const folder = authFolder(dataFolder)
  let login = await openLogin(dataFolder, events.onNote)

  if (!pairing && !login.state.creds.account) return { kind: 'not_linked' }

  /** Only ever acts while no link exists in memory. A linked login is never forgotten here. */
  const startPairingAfresh = async (): Promise<void> => {
    if (login.state.creds.account) return
    forgetLogin(folder)
    login = await openLogin(dataFolder, events.onNote)
  }

  // Whatever an abandoned attempt left behind would be sent as a login.
  if (pairing) await startPairingAfresh()

  let attempt = 0
  let pairingAttempts = 0
  let restartsInARow = 0
  let version: WAVersion | undefined

  while (!signal.aborted) {
    if (!login.state.creds.account) pairingAttempts += 1
    const closed = await connectOnce(options, login, version)
    if (closed.opened) options.onSessionClosed?.()
    await login.flush()
    if (signal.aborted) break

    const linked = Boolean(login.state.creds.account)

    if (closed.statusCode === VERSION_REFUSED && closed.message?.startsWith('Connection Failure')) {
      if (version) return { kind: 'outdated' }
      events.onNote('WhatsApp wants a newer client version. Looking it up and trying again.')
      version = await latestVersion()
      if (!version) return { kind: 'outdated' }
      await startPairingAfresh()
      continue
    }

    const decision = classifyDisconnect(closed)

    if (!linked) {
      // Only reachable while pairing: holding never starts unlinked.
      if (decision.action === 'halt') {
        forgetLogin(folder)
        return { kind: 'pairing_refused', statusCode: closed.statusCode }
      }
      if (pairingAttempts >= MAX_PAIRING_ATTEMPTS) {
        forgetLogin(folder)
        return { kind: 'pairing_gave_up' }
      }
      await startPairingAfresh()
      await sleep(1_000, signal)
      continue
    }

    if (decision.action === 'halt' && decision.haltReason) {
      // Local first (D10): a refused sender must stay refused with no network.
      writeHalt(dataFolder, decision.haltReason)
      return { kind: 'halted', reason: decision.haltReason }
    }

    if (decision.action === 'restart' && restartsInARow < MAX_IMMEDIATE_RESTARTS) {
      restartsInARow += 1
      continue
    }

    if (closed.onlineForMs >= SETTLED_AFTER_MS) {
      attempt = 0
      restartsInARow = 0
    }
    const wait = reconnectDelayMs(attempt)
    attempt += 1
    events.onOffline(wait, closed.statusCode)
    await sleep(wait, signal)
  }

  await login.flush()
  return { kind: 'stopped' }
}

/**
 * What the phone shows under Linked devices: **Google Chrome (Windows)**.
 *
 * The owner asked for the device to read "Shawarmania Ops" (2026-11-17), and
 * the bracketed part is free text in Baileys, so it was tried:
 * `['Shawarmania Ops', 'Chrome', …]`. That was while linking was by pairing
 * code, and four codes in a row were refused with the custom name. Linking is
 * by QR code now, and a QR link is said to tolerate a custom name (WAP Brain
 * uses one), but **that has not been tried here, and both links on this laptop
 * were made with the plain name.** Whether the name can change under a link
 * already made is not known either. Change it only on a number that can be
 * linked again without asking anybody.
 */
function socketConfig(state: AuthenticationState, version: WAVersion | undefined) {
  const browser = Browsers.windows('Chrome')
  return {
    auth: state,
    logger: quiet,
    ...(version ? { version } : {}),
    browser,
    // The phone must keep ringing for customers' messages. A linked device
    // that marks itself online silences the phone's notifications.
    markOnlineOnConnect: false,
    // The older, larger history is never asked for.
    syncFullHistory: false,
  }
}

function connectOnce(
  options: LinkOptions,
  login: Login,
  version: WAVersion | undefined,
): Promise<Closed> {
  return new Promise<Closed>((resolve) => {
    let onlineSince: number | null = null
    let settled = false

    const finish = (disconnect: Disconnect) => {
      if (settled) return
      settled = true
      options.signal.removeEventListener('abort', onAbort)
      resolve({
        ...disconnect,
        onlineForMs: onlineSince === null ? 0 : Date.now() - onlineSince,
        opened: onlineSince !== null,
      })
    }

    let socket: ReturnType<typeof makeWASocket>
    try {
      socket = makeWASocket(socketConfig(login.state, version))
    } catch {
      // Could not even start (no network stack yet after waking, say).
      resolve({ statusCode: undefined, message: undefined, onlineForMs: 0, opened: false })
      return
    }

    function onAbort() {
      // `end` closes the socket and keeps the link; `logout` would remove it.
      socket.end(undefined)
      finish({ statusCode: undefined, message: undefined })
    }
    options.signal.addEventListener('abort', onAbort, { once: true })
    if (options.signal.aborted) onAbort()

    socket.ev.on('creds.update', () => login.save())

    /**
     * WhatsApp has said the account is restricted. The connection is still up,
     * so the sender closes it itself and stays closed (D10): the close is
     * worded as the sender's own, and `classifyDisconnect` halts on it.
     */
    const haltAsRestricted = () => {
      if (!login.state.creds.account) return
      finish(RESTRICTED)
      socket.end(undefined)
    }

    const receiptListeners: ReceiptListener[] = []
    // WhatsApp hands over the receipts it was holding as soon as the socket
    // connects, before the connection reads as open and so before anything has
    // asked to hear them. Seen on 2026-11-17: two messages sent to a phone that
    // was offline reported "delivered" at the start of the *next* run. So
    // receipts are kept from the first moment and replayed to the first
    // listener, and a campaign must match them by message id whenever they come.
    const heldReceipts: Array<[string, ReceiptStatus, string | undefined]> = []
    if (options.onSession) {
      // The only message event the sender listens to, and only for messages it
      // sent itself: it reads a status and an id, never content (D11).
      socket.ev.on('messages.update', (updates) => {
        for (const { key, update } of updates) {
          const status = update.status
          if (TRACE_RECEIPTS) {
            options.events.onNote(
              `trace messages.update id=…${String(key.id).slice(-4)} fromMe=${String(key.fromMe)} status=${String(status)} fields=${Object.keys(update).join(',')}`,
            )
          }
          if (!key.fromMe || !key.id || typeof status !== 'number') continue
          const reading: ReceiptStatus | null =
            status >= STATUS_READ
              ? 'read'
              : status >= STATUS_DELIVERED
                ? 'delivered'
                : status === STATUS_ERROR
                  ? 'rejected'
                  : null
          if (!reading) continue
          // WhatsApp's own code for the refusal, a short number. Nothing else
          // of the message is read.
          const code =
            reading === 'rejected' ? (update.messageStubParameters?.[0] ?? 'unknown') : undefined
          if (receiptListeners.length === 0) heldReceipts.push([key.id, reading, code])
          for (const listener of receiptListeners) listener(key.id, reading, code)
          if (code === MESSAGE_REFUSED_AS_RESTRICTED) haltAsRestricted()
        }
      })
    }

    // Replies of STOP, and nothing else (D11). Every other incoming message is
    // dropped here, unread past the one question, and nothing is kept.
    const stopListeners: Array<(phoneDigits: string) => void> = []
    const heldStops: string[] = []
    if (options.onSession) {
      socket.ev.on('messages.upsert', ({ messages, type }) => {
        if (type !== 'notify') return
        for (const message of messages) {
          const text =
            message.message?.conversation ?? message.message?.extendedTextMessage?.text ?? null
          if (!isStopReply(text)) continue
          const { key } = message
          const known = senderPhone(key)
          const found =
            known !== null
              ? Promise.resolve(known)
              : !key.fromMe && isLidJid(key.remoteJid)
                ? socket.signalRepository.lidMapping
                    .getPNForLID(key.remoteJid as string)
                    .then((pn) => phoneOfJid(pn))
                    .catch(() => null)
                : Promise.resolve(null)
          void found.then((phone) => {
            if (!phone) return
            if (stopListeners.length === 0) heldStops.push(phone)
            for (const listener of stopListeners) listener(phone)
          })
        }
      })
    }

    const session: Session = {
      resolve: async (phoneDigits) => {
        const [found] = (await socket.onWhatsApp(`${phoneDigits}@s.whatsapp.net`)) ?? []
        return found?.exists ? found.jid : null
      },
      send: async (address, message) => {
        let sent: Awaited<ReturnType<typeof socket.sendMessage>>
        try {
          sent = await socket.sendMessage(
            address,
            message.image
              ? { image: message.image, caption: message.text }
              : { text: message.text },
          )
        } catch (error) {
          // The image is uploaded before the message is built, so a failed
          // upload is certain to have sent nothing. Every other failure here
          // is left as it is: nobody can say whether the message went.
          if (error instanceof Error && error.message.startsWith('Media upload failed')) {
            throw new SendRefused('image_upload_failed')
          }
          throw error
        }
        const id = sent?.key.id
        if (!id) throw new Error('WhatsApp gave no id for the message')
        return id
      },
      onReceipt: (listener) => {
        receiptListeners.push(listener)
        for (const [messageId, status, code] of heldReceipts.splice(0)) {
          listener(messageId, status, code)
        }
      },
      onStopReply: (listener) => {
        stopListeners.push(listener)
        for (const phone of heldStops.splice(0)) listener(phone)
      },
    }

    socket.ev.on('connection.update', (update) => {
      const linked = Boolean(login.state.creds.account)

      // "When you are in this state, WhatsApp prevents outgoing messages and
      // calls" (Baileys' own description of the notice).
      if (update.reachoutTimeLock?.isActive) haltAsRestricted()

      if (update.qr && !linked && options.linkByQr) options.events.onQr?.(update.qr)

      if (update.connection === 'open') {
        onlineSince = Date.now()
        // This login provably works. Keep a copy of it (core/creds-file.ts).
        void login.flush().then(() => {
          try {
            backUpCreds(authFolder(options.dataFolder))
          } catch {
            // The backup is a second line of defence; losing one is survivable.
          }
        })
        options.events.onOnline(socket.user?.id ?? '')
        options.onSession?.(session)
      }

      if (update.connection === 'close') {
        finish(disconnectOf(update.lastDisconnect?.error))
      }
    })
  })
}

/**
 * The linked device as the sending loop sees it. A connection opened through
 * this can send; it is given only to `core/sending-loop.ts`.
 */
export function whatsAppLink(dataFolder: string, events: LinkEvents): WhatsAppLink {
  return {
    hold: async (handlers, signal): Promise<LinkEnd> => {
      const outcome = await holdLink({
        dataFolder,
        events,
        signal,
        onSession: handlers.onOpen,
        onSessionClosed: handlers.onClose,
      })
      switch (outcome.kind) {
        case 'stopped':
          return { kind: 'stopped' }
        case 'halted':
          return { kind: 'halted', reason: outcome.reason }
        case 'outdated':
          return { kind: 'unusable', why: 'outdated' }
        // The last two belong to linking, which this never asks for.
        case 'not_linked':
        case 'pairing_gave_up':
        case 'pairing_refused':
          return { kind: 'unusable', why: 'not_linked' }
      }
    },
  }
}

function disconnectOf(error: unknown): Disconnect {
  const boom = error as { message?: unknown; output?: { statusCode?: unknown } } | undefined
  const code = boom?.output?.statusCode
  return {
    statusCode: typeof code === 'number' ? code : undefined,
    message: typeof boom?.message === 'string' ? boom.message : undefined,
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const timer = setTimeout(done, ms)
    function done() {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    signal.addEventListener('abort', done, { once: true })
  })
}

export type ReachResult =
  | { kind: 'reachable'; usedNewerVersion: boolean }
  | { kind: 'outdated' }
  | { kind: 'unreachable'; statusCode: number | undefined }

/**
 * Whether this laptop can reach WhatsApp and be offered a link, without
 * touching any account: it opens a connection with a throwaway login, waits
 * for WhatsApp to offer a QR code, and hangs up. It shows that code to nobody
 * and names no phone number, so nobody's phone hears of it.
 *
 * Run before asking whoever holds the phone for their time.
 */
export async function canReachWhatsApp(
  throwawayFolder: string,
  timeoutMs = 30_000,
): Promise<ReachResult> {
  let version: WAVersion | undefined
  for (;;) {
    forgetLogin(throwawayFolder)
    const { state } = await loadAuthState(throwawayFolder)
    const result = await new Promise<'offered' | Disconnect>((resolve) => {
      const socket = makeWASocket(socketConfig(state, version))
      let done = false
      const settle = (value: 'offered' | Disconnect) => {
        if (done) return
        done = true
        clearTimeout(timer)
        socket.end(undefined)
        resolve(value)
      }
      const timer = setTimeout(
        () => settle({ statusCode: undefined, message: undefined }),
        timeoutMs,
      )
      socket.ev.on('connection.update', (update) => {
        if (update.qr) settle('offered')
        if (update.connection === 'close') settle(disconnectOf(update.lastDisconnect?.error))
      })
    })
    forgetLogin(throwawayFolder)

    if (result === 'offered') return { kind: 'reachable', usedNewerVersion: Boolean(version) }
    if (result.statusCode === VERSION_REFUSED && !version) {
      version = await latestVersion()
      if (!version) return { kind: 'outdated' }
      continue
    }
    if (result.statusCode === VERSION_REFUSED) return { kind: 'outdated' }
    return { kind: 'unreachable', statusCode: result.statusCode }
  }
}
