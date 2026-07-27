/**
 * The only module in the app that touches `navigator.geolocation`.
 *
 * Two reasons it is one module. Everything above it takes a typed reading or a
 * typed failure, which is what makes a blocked check-in testable without a
 * browser permission prompt. And the rule that this system never tracks anyone
 * in the background is then enforceable by reading one file: position is read
 * in direct response to a check-in, a check-out, or an outlet capture, and
 * nowhere else. Adding a background watch would need a deliberate decision in
 * its own proposal (AGENTS.md, docs/SECURITY_AND_PRIVACY.md).
 */

export interface PositionReading {
  latitude: number
  longitude: number
  /** The browser's own confidence, in metres. Stored and displayed, never used to widen a fence. */
  accuracyMetres: number
  /** When the device took the fix, ISO 8601. */
  at: string
}

/**
 * Why no position could be taken. Distinguished because the advice differs:
 * a denied permission is fixed in settings, a timeout by stepping outside.
 */
export type GeolocationFailureKind = 'unsupported' | 'denied' | 'unavailable' | 'timeout'

export type PositionResult =
  | { ok: true; reading: PositionReading }
  | { ok: false; kind: GeolocationFailureKind }

/** Long enough for a cold GPS fix, short enough that nobody waits at a counter wondering. */
const CHECK_IN_TIMEOUT_MS = 10_000

/** How long an outlet capture keeps sampling, looking for a tighter fix. */
const CAPTURE_WINDOW_MS = 8_000

function toReading(position: GeolocationPosition): PositionReading {
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracyMetres: position.coords.accuracy,
    at: new Date(position.timestamp || Date.now()).toISOString(),
  }
}

function toFailureKind(error: GeolocationPositionError): GeolocationFailureKind {
  switch (error.code) {
    case 1:
      return 'denied'
    case 3:
      return 'timeout'
    default:
      return 'unavailable'
  }
}

function geolocation(): Geolocation | null {
  if (typeof navigator === 'undefined') return null
  return navigator.geolocation ?? null
}

/**
 * One high-accuracy reading, for a check-in or check-out. A single sample on
 * purpose: the person is standing at work with their thumb on one big button,
 * and a sampling window would be latency they can feel for a fix that is
 * usually no better.
 */
export function readPosition(timeoutMs: number = CHECK_IN_TIMEOUT_MS): Promise<PositionResult> {
  const api = geolocation()
  if (!api) return Promise.resolve({ ok: false, kind: 'unsupported' })

  return new Promise((resolve) => {
    let settled = false
    const done = (result: PositionResult) => {
      if (settled) return
      settled = true
      resolve(result)
    }

    api.getCurrentPosition(
      (position) => done({ ok: true, reading: toReading(position) }),
      (error) => done({ ok: false, kind: toFailureKind(error) }),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    )
  })
}

export interface CaptureOptions {
  /** How long to keep sampling. */
  windowMs?: number
  /** Called for every sample, best-so-far, so a capture screen can show the fix tighten. */
  onSample?: (reading: PositionReading) => void
}

/**
 * Sample for a few seconds and keep the **best** reading by reported accuracy —
 * for capturing an outlet's permanent position.
 *
 * Best, not averaged. Indoor samples differ in accuracy by an order of
 * magnitude, and a mean drags a good fix toward a bad one; taking the tightest
 * reading the device managed is both simpler and better. Callers see every
 * sample through `onSample`, so the screen can show the number improving rather
 * than freezing for eight seconds.
 */
export function watchBestPosition(options: CaptureOptions = {}): Promise<PositionResult> {
  const api = geolocation()
  if (!api) return Promise.resolve({ ok: false, kind: 'unsupported' })

  const windowMs = options.windowMs ?? CAPTURE_WINDOW_MS

  return new Promise((resolve) => {
    let best: PositionReading | null = null
    let lastFailure: GeolocationFailureKind = 'timeout'
    let settled = false
    let watchId: number | null = null
    let timer: ReturnType<typeof setTimeout> | null = null

    const stop = () => {
      if (watchId !== null) api.clearWatch(watchId)
      if (timer !== null) clearTimeout(timer)
      watchId = null
      timer = null
    }

    const finish = () => {
      if (settled) return
      settled = true
      stop()
      resolve(best ? { ok: true, reading: best } : { ok: false, kind: lastFailure })
    }

    const id = api.watchPosition(
      (position) => {
        const reading = toReading(position)
        if (!best || reading.accuracyMetres < best.accuracyMetres) {
          best = reading
          options.onSample?.(reading)
        }
      },
      (error) => {
        lastFailure = toFailureKind(error)
        // A denial will never resolve by waiting, so stop asking. Anything else
        // may still produce a fix before the window closes.
        if (lastFailure === 'denied') finish()
      },
      { enableHighAccuracy: true, timeout: windowMs, maximumAge: 0 },
    )

    // A browser may invoke either callback synchronously, in which case
    // `finish` has already run and there was no id yet to clear. Reconcile
    // both orderings here rather than leaking the watch.
    if (settled) {
      api.clearWatch(id)
      return
    }

    watchId = id
    timer = setTimeout(finish, windowMs)
  })
}
