/**
 * The campaign sender's command line (a-campaign-goes-out-on-whatsapp).
 *
 * It links the laptop to a WhatsApp account, signs in to the database as an
 * owner, and sends campaigns: `start` runs the sender, which shows its page
 * on the laptop, keeps an icon in the tray, pins a card when a batch waits for
 * Send batch, and sends one customer at a time once a batch is released. The
 * owners' test numbers go by themselves. Two other commands send: `test-send`,
 * one fixed message to one typed number; and `rehearse`, the same loop
 * against a stand-in for the database, which reaches one phone only.
 *
 *   npm run check       can this laptop reach WhatsApp? touches no account
 *   npm run link        link this laptop, by a QR code shown on a local page
 *   npm run sign-in -- staging      sign in to staging's database as an owner
 *   npm run sign-in -- production   or production's (each read from the app)
 *   npm run sign-out    forget the database session on this laptop
 *   npm start           run the sender (Ctrl+C stops it). Not signed in, it
 *                       only holds the WhatsApp link, as it did before
 *       `-- --only-test-recipient` sends to the number in test-recipient.txt
 *       and to nobody else: for a rehearsal against a real database
 *   npm run install-startup     keep the sender running: start it now and at
 *                       every logon, with no window, and start it again
 *                       whenever it stops, until npm run stop
 *   npm run stop        stop it, and keep it stopped, even across a restart,
 *                       until install-startup (or npm start) starts it again
 *   npm run uninstall-startup   no longer start it at logon
 *   npm run keep-running        what install-startup runs: the keeper itself
 *   npm run status      say whether a link is saved here, whether halted, and
 *                       whether it is running and kept running
 *   npm run test-send   send one test message to one number
 *   npm run rehearse    run the sending loop on a rehearsal queue (see below)
 *   npm run restart     clear a halt, after reading why it happened
 *   npm run unlink      forget the WhatsApp login on this laptop
 *
 * Rehearsing:
 *
 *   npm run rehearse -- new text image absent text --gap=15-30 --image=C:\a.jpg
 *       makes the queue: one row per word, six at most. `absent` looks up a
 *       number that is not on WhatsApp and sends nothing. `--window=10:00-21:00`
 *       sets the sending window, on India's clock.
 *       `--wait` makes the batch wait for Send batch, as a real campaign's
 *       does: the card appears, and nothing goes until the button is pressed.
 *       `--tests=1` (up to 3) adds test messages, as test numbers on a
 *       campaign do: they go by themselves, before the batch, with no press.
 *   npm run rehearse -- show     says where the queue has got to
 *   npm run rehearse             runs it, after the word SEND is typed
 *
 * The queue is one file in the sender's folder, read afresh for every
 * question. Changing `campaign.state` in it to `paused`, `scheduled` or
 * `stopped` while a rehearsal runs is how its campaign is paused, resumed
 * and stopped. Setting CAMPAIGN_SENDER_REHEARSE_DIE_AFTER_SEND=2 kills the
 * process the instant its second message has gone, before that is recorded:
 * the worst moment to lose power, on demand.
 */

import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'
import type { Interface } from 'node:readline'

import type { WhatsAppLink } from './core/contracts.ts'
import { CONTROL_PAGE_PORT, serveControlPage } from './core/control-page-server.ts'
import type { ControlPageServer } from './core/control-page-server.ts'
import { controlPage } from './core/control-page.ts'
import { forgetLogin, hasSavedLink } from './core/creds-file.ts'
import {
  authFolder,
  clearHalt,
  dataFolder,
  readHalt,
  realQueueConfigured,
  rehearsalRecipientPath,
} from './core/data-folder.ts'
import { HALT_EXPLANATIONS } from './core/disconnect.ts'
import { LINK_PAGE_PORT, serveLinkPage } from './core/link-page-server.ts'
import type { LinkPageServer } from './core/link-page-server.ts'
import {
  noticeToken,
  readNoticeRecipients,
  sendNotice,
  tappedLink,
  tokenMatches,
} from './core/owner-notice.ts'
import { fullPhoneNumber, lastFour } from './core/phone-number.ts'
import { linkedPage, qrPage, waitingPage } from './core/qr-page.ts'
import { onlyTo } from './core/rehearsal-guard.ts'
import {
  fileStore,
  newRehearsal,
  REHEARSAL_QUEUE_FILE,
  rehearsalQueue,
} from './core/rehearsal-queue.ts'
import type { RehearsalRowKind, RehearsalState, RehearsalStore } from './core/rehearsal-queue.ts'
import {
  isStuck,
  startingView,
  viewAfterEnd,
  viewAfterEvent,
  viewAfterTick,
} from './core/sender-view.ts'
import type { SenderView, ViewContext } from './core/sender-view.ts'
import { runSender, systemClock } from './core/sending-loop.ts'
import type { SenderEnd } from './core/sending-loop.ts'
import type {
  BatchReleaser,
  CampaignQueue,
  OutgoingMessage,
  ClaimedRecipient,
} from './core/contracts.ts'
import {
  addressFromSite,
  databaseName,
  databaseQueue,
  installationId,
  isProduction,
  pictureCache,
  readHistory,
  readQueueAddress,
  signedInClient,
  signIn,
  signOut,
} from './database.ts'
import { renderCampaignMessage } from '../../../shared/campaign-message.ts'
import { SITES } from './core/site-address.ts'
import { STARTUP_FILE, startupScript } from './core/startup.ts'
import type { SenderEvent } from './core/sending-loop.ts'
import { indiaClock, parseClockTime } from './core/sending-window.ts'
import { acquireSingleInstance, heldBy, lockPath } from './core/single-instance.ts'
import {
  KEEPER_LOCK_FILE,
  KEPT_ENV,
  STOP_REQUEST_FILE,
  afterExit,
  readStopRequest,
  stopRequestText,
} from './core/keep-running.ts'
import type { StopRequest } from './core/keep-running.ts'
import { DIARY_FILE, diaryLine, readDiary, trimDiary } from './core/diary.ts'
import type { DiaryTone } from './core/diary.ts'
import { shapeHistory } from './core/history.ts'
import QRCode from 'qrcode'

import { canReachWhatsApp, holdLink, whatsAppLink } from './whatsapp-link.ts'
import type { LinkEvents, LinkOutcome, ReceiptStatus, Session } from './whatsapp-link.ts'

const folder = dataFolder()

// **Nothing but `say` may print.** `libsignal`, underneath Baileys, reports its
// work with `console.*` and passes whole session records to it: on the first
// real send (2026-11-17) it printed a closed session's private keys to the
// terminal. Baileys' own logger is silenced separately; this silences what
// goes round it. `say` writes to stdout directly and is unaffected.
for (const method of ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const) {
  console[method] = () => {}
}

function say(line = ''): void {
  process.stdout.write(`${line}\n`)
}

function clock(): string {
  return new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

// One reader for every question a command asks, read line by line, so answers
// typed ahead or piped in are not lost between questions. It is given no
// output stream, so the terminal stays in its ordinary mode and Ctrl+C reaches
// the process. Closed before anything long-running starts.
let reader: Interface | null = null
let lines: AsyncIterator<string> | null = null

async function ask(question: string): Promise<string> {
  if (!reader) {
    reader = createInterface({ input: process.stdin })
    lines = reader[Symbol.asyncIterator]()
  }
  process.stdout.write(question)
  const next = await lines!.next()
  return next.done ? '' : next.value.trim()
}

function doneAsking(): void {
  reader?.close()
  reader = null
  lines = null
}

/** A halt record written by another version may name a reason this one does not know. */
function explain(reason: string): string {
  return (
    (HALT_EXPLANATIONS as Readonly<Record<string, string>>)[reason] ??
    HALT_EXPLANATIONS.unreadable_record
  )
}

function localTime(iso: string): string {
  const at = new Date(iso)
  return Number.isNaN(at.getTime()) || at.getTime() === 0 ? 'an unknown time' : at.toLocaleString()
}

/** Says why the sender is halted, if it is. True when it is. */
function refusedByHalt(): boolean {
  const halt = readHalt(folder)
  if (!halt) return false
  say(`The sender is halted since ${localTime(halt.at)}.`)
  say(explain(halt.reason))
  say('When that is understood, run: npm run restart')
  return true
}

function stopOnCtrlC(controller = new AbortController()): AbortSignal {
  const stop = () => {
    if (controller.signal.aborted) return
    say()
    say('Stopping. Nothing on the phone is changed.')
    controller.abort()
  }
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'] as const)
    process.on(signal, stop)
  return controller.signal
}

// ── The diary ───────────────────────────────────────────────────────────────

let diaryTrimmed = false
let lastNoted = ''

/**
 * One line in the sender's diary (`core/diary.ts`), which the history page
 * shows. The same line twice in a row is written once: a connection that keeps
 * dropping is one line until something else happens. Never a number. A diary
 * that cannot be written costs the sender nothing.
 */
function note(tone: DiaryTone, text: string): void {
  if (text === lastNoted) return
  lastNoted = text
  const path = join(folder, DIARY_FILE)
  try {
    if (!diaryTrimmed && existsSync(path)) {
      const trimmed = trimDiary(readFileSync(path, 'utf8'))
      if (trimmed !== null) writeFileSync(path, trimmed, 'utf8')
    }
    diaryTrimmed = true
    appendFileSync(path, diaryLine({ at: new Date().toISOString(), tone, text }), 'utf8')
  } catch {
    // The page shows what there is.
  }
}

function readDiaryFile(limit: number) {
  try {
    return readDiary(readFileSync(join(folder, DIARY_FILE), 'utf8'), limit)
  } catch {
    return []
  }
}

/** A time as the history shows it: the time today, the day and month before today. */
function historyClock(ms: number): string {
  const then = new Date(ms)
  const time = then.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  if (then.toDateString() === new Date().toDateString()) return time
  return `${then.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}, ${time}`
}

// ── Kept running, and stopped on request ────────────────────────────────────

function stopRequestPath(): string {
  return join(folder, STOP_REQUEST_FILE)
}

/** The owner's request to stop, or null when there is none. */
function readStopRequestFile(): StopRequest | null {
  const path = stopRequestPath()
  if (!existsSync(path)) return null
  try {
    return readStopRequest(readFileSync(path, 'utf8'))
  } catch {
    return { by: 'unknown', at: null }
  }
}

function stoppedByOwnerLine(request: StopRequest): string {
  const when = request.at ? `, ${localTime(request.at)}` : ''
  return `Stopped by the owner (${request.by}${when}). Start it again: npm run install-startup`
}

/**
 * Stops the sender once the owner asks, by `npm run stop` or the tray icon:
 * the same way out as Ctrl+C, so a message in hand is finished first.
 */
function watchStopRequest(controller: AbortController): void {
  const timer = setInterval(() => {
    if (controller.signal.aborted) {
      clearInterval(timer)
      return
    }
    if (existsSync(stopRequestPath())) {
      clearInterval(timer)
      say(`${clock()}  Asked to stop. Stopping, after the message in hand if there is one.`)
      note('plain', 'Asked to stop.')
      controller.abort()
    }
  }, 2_000)
  timer.unref()
}

const pauseFor = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * The keeper (`core/keep-running.ts`): runs the sender and starts it again
 * whenever it stops, until the owner asks it to stop or it halts. This is
 * what the logon script runs; nothing about it is the Claude app's, a
 * terminal's or any window's, so closing one cannot end it.
 */
async function keepRunning(): Promise<number> {
  const lock = acquireSingleInstance(folder, process.pid, undefined, KEEPER_LOCK_FILE)
  if (!lock.ok) {
    say(`${clock()}  A keeper is already running (process ${lock.heldByPid}). Nothing to do.`)
    return 0
  }
  process.once('exit', lock.release)
  // Ctrl+C in a window running the keeper by hand is a person stopping it.
  let quitting = false
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'] as const) {
    process.on(signal, () => {
      quitting = true
    })
  }
  const program = fileURLToPath(import.meta.url)
  say(
    `${clock()}  Keeper started. The sender is started again whenever it stops, until asked to stop.`,
  )
  note('plain', 'The keeper started, at logon or by install-startup.')
  let quickExits = 0
  for (;;) {
    const asked = readStopRequestFile()
    if (asked) {
      say(`${clock()}  ${stoppedByOwnerLine(asked)}`)
      return 0
    }
    if (quitting) return 0
    const began = Date.now()
    const code = await new Promise<number | null>((resolve) => {
      const child = spawn(process.execPath, [...process.execArgv, program, 'start'], {
        stdio: ['ignore', 'inherit', 'inherit'],
        windowsHide: true,
        env: { ...process.env, [KEPT_ENV]: '1' },
      })
      child.once('exit', (exitCode) => resolve(exitCode))
      child.once('error', () => resolve(null))
    })
    if (quitting) return 0
    const verdict = afterExit({
      code,
      ranMs: Date.now() - began,
      stopAsked: readStopRequestFile() !== null,
      quickExitsBefore: quickExits,
    })
    if (verdict.kind === 'stay_stopped') {
      note(
        verdict.why === 'owner' ? 'plain' : 'alarm',
        verdict.why === 'owner'
          ? 'Stopped, as asked. It stays stopped until started again.'
          : 'The sender halted, so the keeper leaves it stopped.',
      )
      say(
        verdict.why === 'owner'
          ? `${clock()}  ${stoppedByOwnerLine(readStopRequestFile() ?? { by: 'unknown', at: null })}`
          : `${clock()}  The sender halted, so the keeper leaves it stopped. npm run status says why.`,
      )
      return 0
    }
    quickExits = verdict.quickExits
    note(
      'warn',
      `The sender stopped (${code === null || code > 255 ? 'killed' : `exit ${code}`}); the keeper started it again ${Math.round(verdict.afterMs / 1000)} s later.`,
    )
    say(
      `${clock()}  The sender stopped (${code === null || code > 255 ? 'killed' : `exit ${code}`}). Starting it again in ${Math.round(verdict.afterMs / 1000)} s.`,
    )
    // The wait ends early for a stop request or Ctrl+C.
    const until = Date.now() + verdict.afterMs
    while (Date.now() < until && !quitting && !existsSync(stopRequestPath())) {
      await pauseFor(Math.min(2_000, until - Date.now()))
    }
  }
}

/** Asks a running sender, kept or not, to stop, and keeps it stopped until started again. */
async function stopCommand(): Promise<number> {
  mkdirSync(folder, { recursive: true })
  writeFileSync(stopRequestPath(), stopRequestText('npm run stop', new Date()), 'utf8')
  const running = () => heldBy(folder) !== null || heldBy(folder, KEEPER_LOCK_FILE) !== null
  const after =
    'It stays stopped, even after a restart, until it is started again: npm run install-startup'
  if (!running()) {
    say(`The sender was not running. ${after}`)
    return 0
  }
  say('Asked the sender to stop. It finishes the message in hand first …')
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    await pauseFor(2_000)
    if (!running()) {
      say(`Stopped. ${after}`)
      return 0
    }
  }
  say(
    'Still running after two minutes. It stops after the message in hand; npm run status says when.',
  )
  return 1
}

const events: LinkEvents = {
  onOnline: (ownJid) => say(`${clock()}  Connected as ${lastFour(ownJid)}. Nothing is being sent.`),
  onOffline: (retryInMs, statusCode) =>
    say(
      `${clock()}  Connection lost (${statusCode ?? 'no code'}). Trying again in ${Math.round(retryInMs / 1000)} s.`,
    ),
  onNote: (line) => say(`${clock()}  ${line}`),
}

function report(outcome: LinkOutcome): number {
  switch (outcome.kind) {
    case 'stopped':
      return 0
    case 'halted':
      say()
      say('HALTED. The sender will not connect again by itself.')
      say(explain(outcome.reason))
      return 2
    case 'not_linked':
      say('This laptop is not linked to WhatsApp. Run: npm run link')
      return 1
    case 'pairing_gave_up':
      say('Nobody scanned a code in time. Run npm run link again when the phone is in hand.')
      return 1
    case 'pairing_refused':
      say(`WhatsApp refused the link (code ${outcome.statusCode ?? 'none'}). Nothing was linked.`)
      say('Check that the account has a free linked-device slot (four at most).')
      return 1
    case 'outdated':
      say('WhatsApp no longer accepts this version of the sender. It needs updating; nothing')
      say('is wrong with the account. The link, if there was one, is kept.')
      return 1
  }
}

/**
 * Links this laptop by QR code. The code is shown on a page served from this
 * laptop only (`core/link-page-server.ts`), which keeps up as WhatsApp replaces
 * it. Whoever scans it links *their* WhatsApp account to this laptop, so the
 * page stops showing a code the moment the link is made, and the server stops
 * with the command.
 */
async function link(): Promise<number> {
  if (refusedByHalt()) return 2
  if (hasSavedLink(authFolder(folder))) {
    say('This laptop is already linked. To link afresh, run npm run unlink first.')
    return 1
  }
  let page: LinkPageServer
  try {
    page = await serveLinkPage(waitingPage())
  } catch {
    say(
      `Could not open the linking page on port ${LINK_PAGE_PORT}. Is another sender window linking?`,
    )
    return 1
  }
  let shown = 0
  say('Asking WhatsApp for a QR code …')
  const outcome = await holdLink({
    dataFolder: folder,
    linkByQr: true,
    events: {
      ...events,
      onQr: (qr) => {
        shown += 1
        const nth = shown
        QRCode.toString(qr, { type: 'svg', errorCorrectionLevel: 'L', margin: 4 })
          .then((svg) => {
            page.show(qrPage(svg, nth, clock()))
            if (nth > 1) return
            say(`${clock()}  The QR code is showing at ${page.url}`)
            say('  On the phone: WhatsApp → Linked devices → Link a device → scan it.')
            say('  It changes every 20 to 60 seconds, and the page keeps up by itself.')
            say('  If the phone is somewhere else, show that page through a temporary tunnel')
            say('  (the runbook says how). Whoever scans it links their own WhatsApp to this')
            say('  laptop, so it is shown to the person holding the phone and nobody else.')
            if (!process.env['CAMPAIGN_SENDER_NO_BROWSER']) {
              spawn('cmd', ['/c', 'start', '', page.url], {
                detached: true,
                stdio: 'ignore',
              }).unref()
            }
          })
          .catch(() => say(`${clock()}  Could not draw the QR code.`))
      },
      onOnline: (ownJid) => {
        page.show(linkedPage())
        say(`${clock()}  Linked and connected as ${lastFour(ownJid)}. Nothing is being sent.`)
        say('  Leave this window open a few minutes, then Ctrl+C. The link is kept.')
      },
    },
    signal: stopOnCtrlC(),
  })
  await page.close()
  return report(outcome)
}

async function start(): Promise<number> {
  if (refusedByHalt()) return 2
  // Started by a person, not by the keeper: that is the person saying go.
  if (!process.env[KEPT_ENV] && existsSync(stopRequestPath())) {
    rmSync(stopRequestPath(), { force: true })
    say('The stop asked for earlier is cleared: the sender was started by hand.')
  }
  const client = await signedInClient(folder)
  if (!client) {
    say('Not signed in to the database, so nothing will be sent: this only holds the link.')
    say('To send campaigns, run: npm run sign-in')
    say('Connecting to WhatsApp. Ctrl+C stops it and keeps the link.')
    return report(await holdLink({ dataFolder: folder, events, signal: stopOnCtrlC() }))
  }
  if (!hasSavedLink(authFolder(folder))) {
    say('This laptop is not linked to WhatsApp. Run: npm run link')
    return 1
  }
  const address = readQueueAddress(folder)
  say(`Signed in to ${address ? databaseName(address) : 'the database'}.`)

  // A rehearsal against a real database reaches one phone and nobody else.
  let onlyRecipient: string | null = null
  if (process.argv.includes('--only-test-recipient')) {
    const recipient = readTestRecipient()
    if (!recipient) return 1
    onlyRecipient = recipient
    say(`Sending to ${lastFour(recipient)} only, whatever the database hands over.`)
  } else if (address && !isProduction(address)) {
    say('This is not production. Every customer it holds will be sent to.')
  }
  const real = onlyRecipient === null
  if (real) {
    note(
      'plain',
      `Started ${process.env[KEPT_ENV] ? 'by the keeper' : 'by hand'}, sending for ${address ? databaseName(address) : 'the database'}.`,
    )
  }

  let linkedLast4: string | null = null
  const realLink = whatsAppLink(folder, {
    ...events,
    onOnline: (ownJid) => {
      linkedLast4 = lastFour(ownJid).replace(/\D/g, '') || null
      say(`${clock()}  Connected as ${lastFour(ownJid)}.`)
      if (real) note('good', `Connected to WhatsApp as ${lastFour(ownJid)}.`)
    },
    onOffline: (retryInMs, statusCode) => {
      events.onOffline(retryInMs, statusCode)
      if (real) note('warn', 'The WhatsApp connection dropped. It reconnects by itself.')
    },
  })
  // A real run also carries owner notices, on the same connection.
  const tapped = tappedLink(realLink)
  const link = onlyRecipient ? onlyTo(realLink, { recipient: onlyRecipient }) : tapped.link
  const queue = databaseQueue(client, installationId(folder), () => linkedLast4)
  const picture = pictureCache(client)
  const token = real ? noticeToken(folder) : ''

  const controller = new AbortController()
  return runWithFace({
    link,
    queue,
    rehearsal: onlyRecipient !== null,
    ...(real ? { history: () => readHistory(client) } : {}),
    ...(real
      ? {
          notice: async (given: unknown, body: unknown) => {
            if (!tokenMatches(given, token)) {
              return { status: 403, body: { ok: false, message: 'Refused.' } }
            }
            const outcome = await sendNotice(body, readNoticeRecipients(folder), tapped.current())
            say(`${clock()}  Owner notice: ${outcome.ok ? 'sent' : outcome.message}`)
            if (outcome.ok) note('plain', 'An owner notice went out.')
            return { status: outcome.status, body: outcome }
          },
        }
      : {}),
    compose: async (claimed) => {
      const message: OutgoingMessage = {
        text: renderCampaignMessage(claimed.body, claimed.name).text,
      }
      return claimed.imageUrl ? { ...message, image: await picture(claimed.imageUrl) } : message
    },
    controller,
  })
}

/** The number in test-recipient.txt, as digits, or null after saying why not. */
function readTestRecipient(): string | null {
  let written: string
  try {
    written = readFileSync(rehearsalRecipientPath(folder), 'utf8')
  } catch {
    say(`One number only, read from: ${rehearsalRecipientPath(folder)}`)
    say('Put the number there, with its country code, and nothing else.')
    return null
  }
  const recipient = fullPhoneNumber(written)
  if (!recipient.ok) {
    say(`The number in ${rehearsalRecipientPath(folder)} was not understood. ${recipient.problem}`)
    return null
  }
  return recipient.digits
}

/**
 * Asks for a password without showing it. In a terminal, each key is read as
 * it is pressed and nothing is echoed; anywhere else it is read as a line.
 */
async function askHidden(question: string): Promise<string> {
  const input = process.stdin
  if (!input.isTTY) return ask(question)
  doneAsking()
  process.stdout.write(question)
  return new Promise<string>((resolve) => {
    let typed = ''
    input.setRawMode(true)
    input.resume()
    input.setEncoding('utf8')
    const onData = (chunk: string) => {
      for (const key of chunk) {
        if (key === '\r' || key === '\n') {
          input.setRawMode(false)
          input.pause()
          input.off('data', onData)
          process.stdout.write('\n')
          resolve(typed)
          return
        }
        if (key === '\u0003') process.exit(130)
        if (key === '\u0008' || key === '\u007f') typed = typed.slice(0, -1)
        else typed += key
      }
    }
    input.on('data', onData)
  })
}

async function signInCommand(): Promise<number> {
  const known = readQueueAddress(folder)
  let url = process.env['CAMPAIGN_SENDER_SUPABASE_URL'] ?? ''
  let anonKey = process.env['CAMPAIGN_SENDER_ANON_KEY'] ?? ''
  // `npm run sign-in -- staging` or `-- production`: read from the app itself.
  const named = process.argv[3]
  if (named === 'staging' || named === 'production') {
    say(`Reading which database ${SITES[named]} uses …`)
    const found = await addressFromSite(SITES[named])
    if (!found) {
      say('Could not read it from the site. Check the internet connection, or give the')
      say('address and key by hand: npm run sign-in')
      return 1
    }
    url = found.url
    anonKey = found.anonKey
  } else if (named) {
    say('Use: npm run sign-in -- staging, npm run sign-in -- production, or npm run sign-in')
    return 1
  } else if (!url || !anonKey) {
    url = known?.url ?? ''
    anonKey = known?.anonKey ?? ''
  }
  if (!url || !anonKey) {
    say("Which database? Its address and public key are in the app's settings (the same")
    say('two values the app is built with). Neither is a secret.')
    url = await ask('Database address (https://….supabase.co): ')
    anonKey = await ask('Public (anon) key: ')
  }
  if (!/^https?:\/\//.test(url) || anonKey.length < 20) {
    say('That does not look like a database address and key.')
    return 1
  }
  const address = { url: url.trim(), anonKey: anonKey.trim() }
  say(`Signing in to ${databaseName(address)}.`)
  if (isProduction(address)) {
    say('This is PRODUCTION: real customers. Once signed in, npm start sends what an owner')
    say('submits there, batch by batch, each released on this laptop.')
  }
  const login = await ask('Your username or email: ')
  const password = await askHidden('Your password (not shown): ')
  doneAsking()
  const result = await signIn(folder, address, login, password)
  if (result.ok) {
    say("Signed in. The session is kept in the sender's folder and renewed by itself.")
    say('Run npm start to send.')
    return 0
  }
  say(
    result.why === 'unreachable'
      ? 'Could not reach that database. Check the address and the internet connection.'
      : result.why === 'refused'
        ? 'The username or password was not accepted.'
        : 'Signed in, but that account is not an owner, so it may not send campaigns. Not kept.',
  )
  return 1
}

/** The current user's Startup folder, where a file runs at their logon. */
function startupFolder(): string | null {
  const override = process.env['CAMPAIGN_SENDER_STARTUP_DIR']
  if (override) return override
  const roaming = process.env['APPDATA']
  return roaming ? join(roaming, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup') : null
}

async function installStartup(): Promise<number> {
  const startup = startupFolder()
  if (process.platform !== 'win32' || !startup) {
    say('Starting with Windows is for a Windows laptop only.')
    return 1
  }
  if (!hasSavedLink(authFolder(folder))) {
    say(`No WhatsApp link is saved in ${folder}. Link it first: npm run link`)
    return 1
  }
  if (!(await signedInClient(folder))) {
    say(
      'Not signed in to the database here. Sign in first, for example: npm run sign-in -- staging',
    )
    return 1
  }
  const packageDir = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]+$/, '')
  mkdirSync(startup, { recursive: true })
  const script = join(startup, STARTUP_FILE)
  writeFileSync(
    script,
    startupScript({ nodePath: process.execPath, packageDir, dataFolder: folder }),
    'utf8',
  )
  // Installing is the owner saying go: an earlier stop no longer holds.
  rmSync(stopRequestPath(), { force: true })
  const address = readQueueAddress(folder)
  say('Installed. The sender now keeps running, with no window, on:')
  say(`  WhatsApp: the link in ${folder}`)
  say(`  Database: ${address ? databaseName(address) : 'the one signed in here'}`)
  say('It starts at every logon, and is started again whenever it stops, unless WhatsApp')
  say('halts it. To stop it: npm run stop, or Stop the sender on the tray icon.')
  const keeper = heldBy(folder, KEEPER_LOCK_FILE)
  if (keeper !== null) {
    say(`It is already running (keeper process ${keeper}), and is left as it is.`)
  } else if (!process.env['CAMPAIGN_SENDER_STARTUP_DIR']) {
    // Through Explorer, so that no terminal and no app is its parent: closing
    // the window this ran in cannot end it.
    spawn('explorer.exe', [script], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
    say('Started now as well.')
    if (heldBy(folder) !== null) {
      say('A sender started by hand is running too. The kept one takes over when that one')
      say('stops: press Ctrl+C in its window, or close it.')
    }
  }
  say(`What it prints goes to ${join(folder, 'sender.log')}. Its face is the tray icon.`)
  say('To stop it starting at logon as well: npm run uninstall-startup')
  return 0
}

async function uninstallStartup(): Promise<number> {
  const startup = startupFolder()
  const file = startup ? join(startup, STARTUP_FILE) : null
  if (!file || !existsSync(file)) {
    say('The sender was not set to start with Windows. Nothing changed.')
    return 0
  }
  rmSync(file, { force: true })
  say('Removed. The sender no longer starts at logon. One running now keeps running until stopped.')
  return 0
}

async function signOutCommand(): Promise<number> {
  await signOut(folder)
  say('Signed out on this laptop. Nothing will be sent until somebody signs in again.')
  return 0
}

async function status(): Promise<number> {
  say(`Data folder: ${folder}`)
  say(
    hasSavedLink(authFolder(folder))
      ? 'A WhatsApp link is saved on this laptop.'
      : 'No WhatsApp link is saved on this laptop.',
  )
  const address = readQueueAddress(folder)
  say(
    (await signedInClient(folder))
      ? `Signed in to ${address ? databaseName(address) : 'a database'}.`
      : 'Not signed in to the database: npm start would only hold the link.',
  )
  if (!refusedByHalt()) say('Not halted.')
  const asked = readStopRequestFile()
  const keeper = heldBy(folder, KEEPER_LOCK_FILE)
  const sender = heldBy(folder)
  say(
    asked
      ? stoppedByOwnerLine(asked)
      : keeper !== null
        ? `Running, and kept running (keeper process ${keeper}).`
        : sender !== null
          ? `Running in a window (process ${sender}), and not kept running: it ends with that window.`
          : 'Not running. To keep it running: npm run install-startup',
  )
  return 0
}

async function check(): Promise<number> {
  say('Checking that this laptop can reach WhatsApp. No account is touched.')
  const result = await canReachWhatsApp(join(folder, 'check-throwaway'))
  switch (result.kind) {
    case 'reachable':
      say(
        result.usedNewerVersion
          ? 'Reachable, after looking up a newer WhatsApp version. Linking will do the same.'
          : 'Reachable. WhatsApp offered to link this laptop.',
      )
      return 0
    case 'outdated':
      say('WhatsApp does not accept this version of the sender. It needs updating before linking.')
      return 1
    case 'unreachable':
      say(
        `Could not reach WhatsApp (code ${result.statusCode ?? 'none'}). Check the internet connection.`,
      )
      return 1
  }
}

/** How long `test-send` waits to hear that the other phone received the message. */
const RECEIPT_WAIT_MS = 45_000

/** And then how long it waits for the chat to be opened on that phone. */
const READ_WAIT_MS = 120_000

/**
 * Sends one fixed message to one typed number, and says what came back. It
 * exists to prove a real send, an image and a delivery receipt on numbers the
 * owner controls, before any campaign code relies on them.
 */
async function testSend(): Promise<number> {
  if (refusedByHalt()) return 2
  if (!hasSavedLink(authFolder(folder))) {
    say('This laptop is not linked to WhatsApp. Run: npm run link')
    return 1
  }
  const phone = fullPhoneNumber(
    await ask('Number to send ONE test message to, with country code: '),
  )
  if (!phone.ok) {
    say(phone.problem)
    return 1
  }
  const imagePath = await ask('Image file to attach (Enter for none): ')
  let image: Buffer | undefined
  if (imagePath) {
    try {
      image = readFileSync(imagePath)
    } catch {
      say('Could not read that file. Nothing sent.')
      return 1
    }
  }
  const text = `Shawarmania campaign sender: *test message*, sent ${clock()}. Please ignore.`
  say()
  say(`This sends ONE message to ${lastFour(phone.digits)} from the linked WhatsApp account:`)
  say(`  ${text}${image ? '   (with the image)' : ''}`)
  const confirmed = await ask('Type SEND to send it: ')
  doneAsking()
  if (confirmed !== 'SEND') {
    say('Nothing sent.')
    return 1
  }

  const controller = new AbortController()
  let exitCode = 1
  let begun = false

  const sendOnce = async (session: Session): Promise<void> => {
    const address = await session.resolve(phone.digits)
    if (!address) {
      say('That number is not on WhatsApp. Nothing sent.')
      return
    }
    // A receipt can arrive before `send` returns the id it belongs to.
    const early: Array<[string, ReceiptStatus]> = []
    const seen = new Set<ReceiptStatus>()
    let messageId: string | null = null
    let wake: (() => void) | null = null
    session.onReceipt((id, status, code) => {
      if (messageId === null) {
        early.push([id, status])
      } else if (id === messageId) {
        if (status === 'rejected') say(`${clock()}  WhatsApp refused the message (code ${code}).`)
        seen.add(status)
        wake?.()
      }
    })
    messageId = await session.send(address, image ? { text, image } : { text })
    for (const [id, status] of early) if (id === messageId) seen.add(status)
    exitCode = 0

    // A phone that reports `read` has received the message, whether or not a
    // separate `delivered` was seen first.
    const has = (wanted: ReceiptStatus) => seen.has(wanted) || seen.has('read')
    const waitFor = (wanted: ReceiptStatus, ms: number) =>
      new Promise<boolean>((resolve) => {
        if (has(wanted)) return resolve(true)
        const timer = setTimeout(() => {
          wake = null
          resolve(false)
        }, ms)
        wake = () => {
          if (!has(wanted)) return
          clearTimeout(timer)
          wake = null
          resolve(true)
        }
      })

    say(`${clock()}  Sent. Waiting up to ${RECEIPT_WAIT_MS / 1000} s for the other phone …`)
    if (!(await waitFor('delivered', RECEIPT_WAIT_MS))) {
      say(`${clock()}  No receipt yet. The message was accepted; the other phone may be offline.`)
      return
    }
    say(
      `${clock()}  Receipt: delivered. Waiting up to ${READ_WAIT_MS / 1000} s for it to be read …`,
    )
    say(
      (await waitFor('read', READ_WAIT_MS))
        ? `${clock()}  Receipt: read.`
        : `${clock()}  Not read in that time, or read receipts are off on one of the two phones.`,
    )
  }

  const outcome = await holdLink({
    dataFolder: folder,
    events: {
      ...events,
      onOnline: (ownJid) => say(`${clock()}  Connected as ${lastFour(ownJid)}.`),
    },
    signal: stopOnCtrlC(controller),
    onSession: (session) => {
      if (begun) return
      begun = true
      sendOnce(session)
        .catch(() => say('The send failed. Nothing may have been sent.'))
        .finally(() => controller.abort())
    },
  })
  return outcome.kind === 'stopped' ? exitCode : report(outcome)
}

// ── Rehearsing the sending loop ─────────────────────────────────────────────

/**
 * What an `absent` row looks up. It is from the range telephone companies
 * keep for fiction, so it is nobody's number; and `onlyTo` refuses to send to
 * it even if WhatsApp were to say it exists.
 */
const REHEARSAL_ABSENT_NUMBER = '12135550100'

/** The recipient is a real phone. A rehearsal queue is kept short. */
const REHEARSAL_MOST_ROWS = 6

/** How long a finished rehearsal stays connected to hear its receipts. */
const REHEARSAL_LINGER_MS = 40_000

function describeRehearsal(state: RehearsalState): void {
  say(
    `Rehearsal queue: campaign ${state.campaign.state}${state.campaign.pausedBecause ? ` (${state.campaign.pausedBecause})` : ''}, batch ${state.batch.state}, gap ${state.minGapSeconds} to ${state.maxGapSeconds} s, window ${state.windowStart} to ${state.windowEnd} India time.`,
  )
  for (const row of state.recipients) {
    const receipts = [row.deliveredAt ? 'delivered' : '', row.readAt ? 'read' : '']
      .filter(Boolean)
      .join(', ')
    const detail = row.failureCode ?? receipts
    say(
      `  ${String(row.position).padStart(2)}  ${row.kind.padEnd(6)}  ${row.state}${detail ? `  (${detail})` : ''}`,
    )
  }
  for (const [index, test] of (state.tests ?? []).entries()) {
    say(
      `   t${index + 1}  test    ${test.state}${test.failureCode ? `  (${test.failureCode})` : ''}`,
    )
  }
}

function rehearseNew(store: RehearsalStore, args: string[]): number {
  const kinds: RehearsalRowKind[] = []
  let gap: [number, number] | null = null
  let window: [string, string] | null = null
  let imagePath: string | null = null
  let waitForRelease = false
  let tests = 0
  for (const arg of args) {
    if (arg === 'text' || arg === 'image' || arg === 'absent') {
      kinds.push(arg)
      continue
    }
    const gapMatch = /^--gap=(\d+)-(\d+)$/.exec(arg)
    const windowMatch = /^--window=(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/.exec(arg)
    if (gapMatch) {
      gap = [Number(gapMatch[1]), Number(gapMatch[2])]
    } else if (windowMatch?.[1] && windowMatch[2]) {
      window = [windowMatch[1], windowMatch[2]]
    } else if (/^--tests=[1-3]$/.test(arg)) {
      tests = Number(arg.slice('--tests='.length))
    } else if (arg === '--wait') {
      waitForRelease = true
    } else if (arg.startsWith('--image=')) {
      imagePath = arg.slice('--image='.length)
    } else {
      say(`Not understood: ${arg}`)
      say(
        'Rows are text, image or absent. Options: --wait --tests=1 --gap=15-30 --window=10:00-21:00 --image=<file>',
      )
      return 1
    }
  }
  if (kinds.length === 0 || kinds.length > REHEARSAL_MOST_ROWS) {
    say(
      `Name one to ${REHEARSAL_MOST_ROWS} rows, for example: npm run rehearse -- new text image text`,
    )
    return 1
  }
  if (gap && (gap[0] < 5 || gap[1] < gap[0])) {
    say('The gap is two numbers of seconds, smallest first, and at least 5.')
    return 1
  }
  if (window && (parseClockTime(window[0]) === null || parseClockTime(window[1]) === null)) {
    say('The window is two times, for example --window=10:00-21:00.')
    return 1
  }
  if (kinds.includes('image')) {
    if (!imagePath) {
      say('An image row needs --image=<file>.')
      return 1
    }
    try {
      readFileSync(imagePath)
    } catch {
      say('Could not read that image file.')
      return 1
    }
  }
  const state = newRehearsal(kinds, {
    ...(gap ? { minGapSeconds: gap[0], maxGapSeconds: gap[1] } : {}),
    ...(window ? { windowStart: window[0], windowEnd: window[1] } : {}),
    body: `Shawarmania campaign sender: *rehearsal* ${clock()}, message {position} of {total}. Please ignore.`,
    imagePath,
    waitForRelease,
    tests,
  })
  store.save(state)
  say(`Written: ${join(folder, REHEARSAL_QUEUE_FILE)}`)
  describeRehearsal(state)
  say('Nothing is sent until: npm run rehearse')
  return 0
}

function sayEvent(event: SenderEvent): void {
  const at = clock()
  switch (event.kind) {
    case 'waiting_for_whatsapp':
      return say(`${at}  Waiting for the WhatsApp connection.`)
    case 'idle':
      if (event.waiting) {
        return say(
          `${at}  Batch ${event.waiting.batchNo} of “${event.waiting.campaignName}” (${event.waiting.recipients} people) is waiting to be released.`,
        )
      }
      return say(
        event.campaignsOpen
          ? `${at}  Nothing may be sent just now: the campaign is paused or its batch is not released.`
          : `${at}  Nothing left to send.`,
      )
    case 'outside_hours': {
      const opens = event.opensAt
        ? `It opens at ${indiaClock(event.opensAt.getTime())} India time, ${Math.ceil((event.opensAt.getTime() - Date.now()) / 60_000)} min from now.`
        : ''
      return say(
        `${at}  Outside the sending window: it is ${indiaClock(Date.now())} in India. Nothing is sent. ${opens}`,
      )
    }
    case 'held':
      return say(`${at}  The queue will not hand over the next recipient: ${event.why}.`)
    case 'stood_down':
      return say(`${at}  Another sender is the one in use. This one is standing down.`)
    case 'database_unreachable':
      return say(
        `${at}  Cannot reach the queue. Nothing is sent. Trying again in ${Math.round(event.retryInMs / 1000)} s.`,
      )
    case 'gap':
      return say(`${at}  Waiting ${Math.round(event.ms / 1000)} s before the next message.`)
    case 'sent':
      return say(
        event.batchNo === 0
          ? `${at}  Sent to a test number. No release was needed.`
          : `${at}  Sent no. ${event.position}.`,
      )
    case 'not_on_whatsapp':
      return say(`${at}  No. ${event.position} is not on WhatsApp. Recorded; moving on.`)
    case 'failed':
      return say(`${at}  No. ${event.position} was not sent (${event.code}). Recorded as failed.`)
    case 'send_unclear':
      return say(
        `${at}  No. ${event.position}: cannot tell whether the message went. It will read unsure and is not retried.`,
      )
    case 'report_refused':
      return say(`${at}  The queue would not record the result for no. ${event.position}.`)
    case 'unsure':
      return say(
        `${at}  ${event.count} recipient(s) were left mid-send. Marked unsure; never sent to again.`,
      )
    case 'paused_by_sender':
      return say(`${at}  Three sends in a row went wrong. The sender has paused the campaign.`)
    case 'batch_finished':
      return say(`${at}  Batch ${event.batchNo} is finished.`)
    case 'finish_notice':
      return say(
        event.sent
          ? `${at}  A campaign is finished. Its totals went to the owner who submitted it.`
          : `${at}  A campaign is finished, and its totals could not be sent. Tried again next start.`,
      )
    case 'receipts':
      return say(
        `${at}  Receipts recorded: ${event.delivered} delivered, ${event.read} read, ${event.rejected} refused.`,
      )
  }
}

function clockAt(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

/**
 * Starts the tray icon and its pinned card (`windows/tray.ps1`). It runs
 * beside the sender, draws what the sender's page reports, and stops by itself
 * shortly after the sender does. A sender without it still works; it only has
 * no face.
 */
function startTray(port: number): void {
  if (process.platform !== 'win32' || process.env['CAMPAIGN_SENDER_NO_TRAY']) return
  const script = fileURLToPath(new URL('../windows/tray.ps1', import.meta.url))
  try {
    spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-WindowStyle',
        'Hidden',
        '-File',
        script,
        '-Port',
        String(port),
        '-StopFile',
        stopRequestPath(),
      ],
      // Not detached: Windows PowerShell started with no console at all exits
      // at once, before it has read the script (found 2026-11-18).
      { stdio: 'ignore', windowsHide: true },
    ).unref()
  } catch {
    say(`${clock()}  Could not start the tray icon. The sender's page still works.`)
  }
}

/** Kills this process, with no goodbye, the instant its nth message has gone. */
function dyingAfterSend(link: WhatsAppLink, nth: number): WhatsAppLink {
  let sends = 0
  return {
    hold: (handlers, signal) =>
      link.hold(
        {
          onOpen: (connection) =>
            handlers.onOpen({
              ...connection,
              send: async (address, message) => {
                const id = await connection.send(address, message)
                sends += 1
                if (sends === nth) {
                  say(
                    `${clock()}  Message ${nth} has gone. Dying now, before it is recorded, as asked.`,
                  )
                  process.kill(process.pid, 'SIGKILL')
                }
                return id
              },
            }),
          onClose: handlers.onClose,
        },
        signal,
      ),
  }
}

async function rehearseRun(store: RehearsalStore): Promise<number> {
  if (refusedByHalt()) return 2
  if (!hasSavedLink(authFolder(folder))) {
    say('This laptop is not linked to WhatsApp. Run: npm run link')
    return 1
  }
  if (realQueueConfigured(folder)) {
    say('This laptop is signed in to the real campaign queue. A rehearsal is not run here.')
    return 1
  }
  let state: RehearsalState
  try {
    state = store.load()
  } catch {
    say('There is no rehearsal queue. Make one first, for example:')
    say('  npm run rehearse -- new text image text --gap=15-30 --image=<file>')
    return 1
  }
  let written: string
  try {
    written = readFileSync(rehearsalRecipientPath(folder), 'utf8')
  } catch {
    say(`A rehearsal sends to one number only, read from: ${rehearsalRecipientPath(folder)}`)
    say('Put the number there, with its country code, and nothing else.')
    return 1
  }
  const recipient = fullPhoneNumber(written)
  if (!recipient.ok) {
    say(`The number in ${rehearsalRecipientPath(folder)} was not understood. ${recipient.problem}`)
    return 1
  }

  describeRehearsal(state)
  const toSend =
    state.recipients.filter((row) => row.state === 'waiting' && row.kind !== 'absent').length +
    (state.tests ?? []).filter((test) => test.state === 'waiting').length
  say()
  say(
    `This sends up to ${toSend} message(s) to ${lastFour(recipient.digits)} and to nobody else, from the linked WhatsApp account.`,
  )
  const confirmed = await ask('Type SEND to start: ')
  doneAsking()
  if (confirmed !== 'SEND') {
    say('Nothing sent.')
    return 1
  }

  const controller = new AbortController()

  let link = onlyTo(
    whatsAppLink(folder, {
      ...events,
      onOnline: (ownJid) => say(`${clock()}  Connected as ${lastFour(ownJid)}.`),
    }),
    { recipient: recipient.digits, lookupOnly: [REHEARSAL_ABSENT_NUMBER] },
  )
  const dieAfter = Number(process.env['CAMPAIGN_SENDER_REHEARSE_DIE_AFTER_SEND'] ?? '')
  if (Number.isInteger(dieAfter) && dieAfter > 0) link = dyingAfterSend(link, dieAfter)

  const queue = rehearsalQueue(store, systemClock, (row) =>
    row.kind === 'absent' ? REHEARSAL_ABSENT_NUMBER : recipient.digits,
  )

  const code = await runWithFace({
    link,
    queue,
    rehearsal: true,
    compose: async (claimed) =>
      claimed.imageUrl
        ? { text: claimed.body, image: readFileSync(claimed.imageUrl) }
        : { text: claimed.body },
    controller,
    stopWhenFinished: true,
  })

  say()
  try {
    describeRehearsal(store.load())
  } catch {
    say('The rehearsal queue could not be read back.')
  }
  return code
}

/**
 * Runs the sending loop with its face on the laptop: the Send batch page, the
 * tray icon and the pinned card. The same for a rehearsal and the real thing;
 * only the queue and how a message is put together differ.
 */
/** The events worth a line in the diary. Sends are not: the database holds those. */
function noteEvent(event: SenderEvent): void {
  switch (event.kind) {
    case 'paused_by_sender':
      return note('alarm', 'Three sends in a row went wrong, so the sender paused the campaign.')
    case 'batch_finished':
      return note('good', `Batch ${event.batchNo} finished.`)
    case 'unsure':
      return note('warn', `${event.count} message(s) were cut off mid-send and marked unsure.`)
    case 'database_unreachable':
      return note('warn', 'The database could not be reached. Nothing is sent until it can.')
    case 'stood_down':
      return note('warn', 'Another sender is the one in use, so this one stood down.')
    case 'finish_notice':
      return event.sent
        ? note('good', 'A campaign finished; its totals went to the owner who submitted it.')
        : undefined
    default:
      return undefined
  }
}

async function runWithFace(options: {
  link: WhatsAppLink
  queue: CampaignQueue & BatchReleaser
  rehearsal: boolean
  compose: (claimed: ClaimedRecipient) => Promise<OutgoingMessage>
  controller: AbortController
  /** A rehearsal stops by itself once nothing is left; the real sender runs on. */
  stopWhenFinished?: boolean
  /** The database's half of the history page; none in a rehearsal, which keeps no diary. */
  history?: () => Promise<unknown>
  /** Owner notices (`owner-notice.ts`); a real run only. */
  notice?: (
    token: unknown,
    body: unknown,
  ) => Promise<{ status: number; body: Record<string, unknown> }>
}): Promise<number> {
  const diaryOn = options.history !== undefined
  const history = options.history
  const { link, queue, controller } = options
  const signal = stopOnCtrlC(controller)
  if (!options.rehearsal) watchStopRequest(controller)
  // A second Ctrl+C does not wait for the message in hand.
  let interrupts = 0
  process.on('SIGINT', () => {
    interrupts += 1
    if (interrupts > 1) process.exit(130)
  })

  const viewNow = (): ViewContext => ({ now: Date.now(), clockText: clockAt })
  let view: SenderView = startingView(viewNow())
  let askNow = () => {}
  let page: ControlPageServer
  try {
    page = await serveControlPage({
      token: randomBytes(24).toString('base64url'),
      page: controlPage,
      state: () => ({ ...view, stuck: isStuck(view, Date.now()), rehearsal: options.rehearsal }),
      onRelease: async () => {
        const waiting = view.waiting
        if (!waiting) return { ok: false, message: 'No batch is waiting.' }
        if (!(await queue.releaseBatch(waiting))) {
          return { ok: false, message: 'That batch is not waiting any more.' }
        }
        say(`${clock()}  Send batch pressed: batch ${waiting.batchNo} is released.`)
        if (diaryOn) {
          note('good', `Send batch pressed: batch ${waiting.batchNo} of “${waiting.campaignName}”.`)
        }
        askNow()
        return { ok: true, message: `Batch ${waiting.batchNo} is released. Sending starts now.` }
      },
      ...(options.notice ? { notice: options.notice } : {}),
      ...(history
        ? {
            history: async () => {
              const context = { now: Date.now(), clockText: historyClock }
              const diary = readDiaryFile(200)
              try {
                return { ...shapeHistory(await history(), diary, context), databaseError: false }
              } catch {
                return { ...shapeHistory(null, diary, context), databaseError: true }
              }
            },
          }
        : {}),
    })
  } catch {
    say(`Could not open the sender's page on port ${CONTROL_PAGE_PORT}. Is another sender running?`)
    return 1
  }
  say(`${clock()}  The sender's page: ${page.url}`)
  startTray(CONTROL_PAGE_PORT)

  let lingering = false
  const end: SenderEnd = await runSender({
    link,
    queue,
    clock: systemClock,
    random: Math.random,
    compose: options.compose,
    onTick: (tick) => {
      view = viewAfterTick(view, tick, viewNow())
    },
    onReady: (controls) => {
      askNow = controls.askNow
    },
    onEvent: (event) => {
      view = viewAfterEvent(view, event, viewNow())
      sayEvent(event)
      if (diaryOn) noteEvent(event)
      if (options.stopWhenFinished && event.kind === 'idle' && !event.campaignsOpen && !lingering) {
        lingering = true
        say(
          `${clock()}  Staying connected ${REHEARSAL_LINGER_MS / 1000} s to hear receipts, then stopping.`,
        )
        setTimeout(() => controller.abort(), REHEARSAL_LINGER_MS)
      }
    },
    signal,
  })
  view = viewAfterEnd(view, end, end.kind === 'halted' ? explain(end.reason) : '', viewNow())
  await page.close()
  if (diaryOn) {
    if (end.kind === 'stopped') note('plain', 'Stopped.')
    else if (end.kind === 'halted') note('alarm', `Halted: ${explain(end.reason)}`)
    else note('alarm', 'Stopped: it needs a person to look (npm run status).')
  }

  switch (end.kind) {
    case 'stopped':
      return 0
    case 'halted':
      say()
      say('HALTED. The sender will not connect again by itself.')
      say(explain(end.reason))
      return 2
    case 'unusable':
      return report({ kind: end.why })
    case 'needs_update':
      say('The database expects a newer sender. It needs updating.')
      return 1
  }
}

async function rehearse(): Promise<number> {
  const store = fileStore(folder)
  const args = process.argv.slice(3)
  if (args[0] === 'new') return rehearseNew(store, args.slice(1))
  if (args[0] === 'show') {
    try {
      describeRehearsal(store.load())
      return 0
    } catch {
      say('There is no rehearsal queue.')
      return 1
    }
  }
  if (args.length > 0) {
    say('Use: npm run rehearse -- new <rows…>, npm run rehearse -- show, or npm run rehearse')
    return 1
  }
  return alone(() => rehearseRun(store))()
}

async function restart(): Promise<number> {
  const halt = readHalt(folder)
  if (!halt) {
    say('The sender is not halted.')
    return 0
  }
  say(`Halted since ${localTime(halt.at)}: ${explain(halt.reason)}`)
  const answer = await ask('Type RESTART to let the sender connect again: ')
  doneAsking()
  if (answer !== 'RESTART') {
    say('Left halted.')
    return 1
  }
  clearHalt(folder)
  say('Cleared. Run npm start, or npm run unlink then npm run link if it must be linked again.')
  return 0
}

async function unlink(): Promise<number> {
  const answer = await ask('Type UNLINK to forget the WhatsApp login on this laptop: ')
  doneAsking()
  if (answer !== 'UNLINK') {
    say('Nothing changed.')
    return 1
  }
  forgetLogin(authFolder(folder))
  clearHalt(folder)
  say('Forgotten here. Also remove the device under Linked devices on the phone.')
  return 0
}

/** These hold or change the WhatsApp login, so only one may run at a time. */
function alone(run: () => Promise<number>): () => Promise<number> {
  return async () => {
    const lock = acquireSingleInstance(folder)
    if (!lock.ok) {
      say(`The sender is already running in another window (process ${lock.heldByPid}).`)
      say(`If no other window is open, delete this file and try again: ${lockPath(folder)}`)
      return 1
    }
    // On every way out, including process.exit and a closed window.
    process.once('exit', lock.release)
    return run()
  }
}

// Baileys does work of its own in the background. A failure there must not
// take the connection down with it, and must not print what it was handling.
process.on('unhandledRejection', () => {
  say(`${clock()}  An internal WhatsApp-library error was ignored.`)
})
process.on('uncaughtException', () => {
  say(`${clock()}  An internal error was ignored.`)
})

const commands: Record<string, () => Promise<number>> = {
  check,
  link: alone(link),
  'sign-in': signInCommand,
  'install-startup': installStartup,
  'uninstall-startup': uninstallStartup,
  'sign-out': signOutCommand,
  start: alone(start),
  'keep-running': keepRunning,
  stop: stopCommand,
  status,
  'test-send': alone(testSend),
  rehearse,
  restart,
  unlink: alone(unlink),
}
const command = commands[process.argv[2] ?? 'start']

if (!command) {
  say(
    'Commands: check, link, sign-in, sign-out, start, install-startup, uninstall-startup, keep-running, stop, status, test-send, rehearse, restart, unlink',
  )
  process.exit(1)
}

process.exit(await command())
