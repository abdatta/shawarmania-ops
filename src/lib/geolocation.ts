/**
 * The only module in the app that touches `navigator.geolocation`.
 *
 * Two reasons it is one module. Everything above it takes a typed reading or a
 * typed failure, which is what makes a blocked check-in testable without a
 * browser permission prompt. And the rule that this system never tracks anyone
 * in the background is then enforceable by reading one file: position is read
 * in direct response to a check-in, an approval, an outlet capture, or the
 * opening of one of the Cash drawer's recording sheets, and nowhere else.
 * Adding a background watch would need a deliberate decision in its own
 * proposal (AGENTS.md, docs/SECURITY_AND_PRIVACY.md).
 *
 * **That list is exhaustive and is meant to stay short.** The drawer joined it
 * in `cash-is-counted-not-closed` (design D20), where the reading is what
 * decides whether the recorder is asked why they were elsewhere; it takes one
 * reading when a sheet is opened to record something, and none while the
 * surface merely sits on screen.
 *
 * A check-in may now keep reading for a few seconds when its first reading is
 * poor (`readCheckInPosition`, a-check-in-at-the-shop-approves-itself, design
 * D7). That is still a reading in direct response to the check-in, stopped the
 * moment it is answered, and so inside the rule above.
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
  { ok: true; reading: PositionReading } | { ok: false; kind: GeolocationFailureKind }

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

let standIn: Geolocation | null = null

/**
 * The demo's stand-in for the phone's own location (`demo-check-in-place.tsx`),
 * or null for the device's. Only the demo sets it; nothing in the app reads a
 * position any other way than through this module.
 */
export function standInGeolocation(source: Geolocation | null): void {
  standIn = source
}

function geolocation(): Geolocation | null {
  if (standIn) return standIn
  if (typeof navigator === 'undefined') return null
  return navigator.geolocation ?? null
}

/**
 * One high-accuracy reading, for a check-in or an approval. A single sample on
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
  /**
   * Stop as soon as the best reading so far passes this. Absent, the whole
   * window is sampled, which is what an outlet capture wants.
   */
  until?: (reading: PositionReading) => boolean
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
          if (options.until?.(reading)) finish()
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

/** How long a check-in keeps reading after a poor first reading. */
const CHECK_IN_REFINE_WINDOW_MS = 6_000

/**
 * A check-in's position, read as `readPosition` reads it and kept reading only
 * when that is not good enough (a-check-in-at-the-shop-approves-itself, design
 * D7).
 *
 * This reverses the single-sample rule above for one case. The reason it was
 * one sample — a window is latency the person can feel — still holds for a good
 * first reading, which is the usual one and is answered at once. But since a
 * check-in at the shop approves itself, a reading that lands outside the fence
 * or reports a wide error costs a manager's tap, so a few more seconds of
 * reading, shown tightening, is now the better trade.
 *
 * @param goodEnough whether a reading needs no refining: inside the fence and
 *   tight enough, say. The first reading that passes ends the wait.
 */
export async function readCheckInPosition(
  goodEnough: (reading: PositionReading) => boolean,
  options: { onRefining?: (reading: PositionReading) => void; windowMs?: number } = {},
): Promise<PositionResult> {
  const first = await readPosition()
  if (!first.ok || goodEnough(first.reading)) return first

  options.onRefining?.(first.reading)
  const refined = await watchBestPosition({
    windowMs: options.windowMs ?? CHECK_IN_REFINE_WINDOW_MS,
    ...(options.onRefining ? { onSample: options.onRefining } : {}),
    until: goodEnough,
  })
  if (!refined.ok) return first
  // The window reports its best by accuracy; the first reading may still be
  // the better answer if nothing during the window beat it.
  if (goodEnough(refined.reading)) return refined
  return refined.reading.accuracyMetres < first.reading.accuracyMetres ? refined : first
}
