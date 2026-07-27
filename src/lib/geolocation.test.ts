import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { readPosition, watchBestPosition } from './geolocation'

/**
 * Drives the one module that touches `navigator.geolocation` against a stub.
 * Every blocked-state screen above it is testable because of this seam — no
 * test in this repo should ever need a real permission prompt.
 */

interface StubPosition {
  latitude: number
  longitude: number
  accuracy: number
  timestamp?: number
}

const position = ({ latitude, longitude, accuracy, timestamp }: StubPosition) =>
  ({
    coords: { latitude, longitude, accuracy },
    timestamp: timestamp ?? Date.parse('2026-07-27T10:00:00Z'),
  }) as GeolocationPosition

const failure = (code: number) => ({ code }) as GeolocationPositionError

const PERMISSION_DENIED = 1
const POSITION_UNAVAILABLE = 2
const TIMEOUT = 3

let getCurrentPosition: ReturnType<typeof vi.fn>
let watchPosition: ReturnType<typeof vi.fn>
let clearWatch: ReturnType<typeof vi.fn>

function install() {
  getCurrentPosition = vi.fn()
  watchPosition = vi.fn().mockReturnValue(7)
  clearWatch = vi.fn()
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition, watchPosition, clearWatch },
  })
}

beforeEach(install)

afterEach(() => {
  Reflect.deleteProperty(navigator, 'geolocation')
  vi.useRealTimers()
})

describe('readPosition', () => {
  it('resolves a typed reading', async () => {
    getCurrentPosition.mockImplementation((onSuccess: PositionCallback) =>
      onSuccess(position({ latitude: 22.975, longitude: 88.4345, accuracy: 12 })),
    )

    await expect(readPosition()).resolves.toEqual({
      ok: true,
      reading: {
        latitude: 22.975,
        longitude: 88.4345,
        accuracyMetres: 12,
        at: '2026-07-27T10:00:00.000Z',
      },
    })
  })

  it('asks for high accuracy and refuses a cached fix', async () => {
    getCurrentPosition.mockImplementation((onSuccess: PositionCallback) =>
      onSuccess(position({ latitude: 1, longitude: 1, accuracy: 5 })),
    )
    await readPosition()

    expect(getCurrentPosition).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      expect.objectContaining({ enableHighAccuracy: true, maximumAge: 0 }),
    )
  })

  it.each([
    [PERMISSION_DENIED, 'denied'],
    [POSITION_UNAVAILABLE, 'unavailable'],
    [TIMEOUT, 'timeout'],
  ] as const)('maps error code %d to %s', async (code, kind) => {
    getCurrentPosition.mockImplementation((_ok: PositionCallback, onError: PositionErrorCallback) =>
      onError(failure(code)),
    )

    await expect(readPosition()).resolves.toEqual({ ok: false, kind })
  })

  it('treats an unrecognised error code as unavailable rather than throwing', async () => {
    getCurrentPosition.mockImplementation((_ok: PositionCallback, onError: PositionErrorCallback) =>
      onError(failure(99)),
    )

    await expect(readPosition()).resolves.toEqual({ ok: false, kind: 'unavailable' })
  })

  it('reports an unsupported browser without calling anything', async () => {
    Reflect.deleteProperty(navigator, 'geolocation')

    await expect(readPosition()).resolves.toEqual({ ok: false, kind: 'unsupported' })
  })

  it('settles once even if the browser calls back twice', async () => {
    getCurrentPosition.mockImplementation(
      (onSuccess: PositionCallback, onError: PositionErrorCallback) => {
        onSuccess(position({ latitude: 1, longitude: 2, accuracy: 9 }))
        onError(failure(TIMEOUT))
      },
    )

    const result = await readPosition()
    expect(result.ok).toBe(true)
  })
})

describe('watchBestPosition', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('keeps the tightest sample, not the last and not the mean', async () => {
    const samples: number[] = []
    watchPosition.mockImplementation((onSuccess: PositionCallback) => {
      onSuccess(position({ latitude: 22.9, longitude: 88.4, accuracy: 80 }))
      onSuccess(position({ latitude: 22.975, longitude: 88.4345, accuracy: 9 }))
      onSuccess(position({ latitude: 22.8, longitude: 88.3, accuracy: 65 }))
      return 7
    })

    const pending = watchBestPosition({ onSample: (r) => samples.push(r.accuracyMetres) })
    await vi.advanceTimersByTimeAsync(8_000)
    const result = await pending

    expect(result).toEqual({
      ok: true,
      reading: {
        latitude: 22.975,
        longitude: 88.4345,
        accuracyMetres: 9,
        at: '2026-07-27T10:00:00.000Z',
      },
    })
    // Only improvements are reported, so the screen never shows a fix
    // getting worse.
    expect(samples).toEqual([80, 9])
  })

  it('stops watching once the window closes', async () => {
    watchPosition.mockImplementation((onSuccess: PositionCallback) => {
      onSuccess(position({ latitude: 1, longitude: 1, accuracy: 10 }))
      return 7
    })

    const pending = watchBestPosition()
    await vi.advanceTimersByTimeAsync(8_000)
    await pending

    expect(clearWatch).toHaveBeenCalledWith(7)
  })

  it('gives up immediately when permission is denied, rather than waiting out the window', async () => {
    watchPosition.mockImplementation(
      (_ok: PositionCallback, onError: PositionErrorCallback) => {
        onError(failure(PERMISSION_DENIED))
        return 7
      },
    )

    // No timer advance: a denial resolves on its own.
    await expect(watchBestPosition()).resolves.toEqual({ ok: false, kind: 'denied' })
    expect(clearWatch).toHaveBeenCalledWith(7)
  })

  it('keeps waiting after a transient failure, and still returns a later fix', async () => {
    watchPosition.mockImplementation(
      (onSuccess: PositionCallback, onError: PositionErrorCallback) => {
        onError(failure(POSITION_UNAVAILABLE))
        setTimeout(() => onSuccess(position({ latitude: 5, longitude: 6, accuracy: 30 })), 2_000)
        return 7
      },
    )

    const pending = watchBestPosition()
    await vi.advanceTimersByTimeAsync(8_000)
    const result = await pending

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.reading.accuracyMetres).toBe(30)
  })

  it('reports the last failure when the window closes with no fix at all', async () => {
    watchPosition.mockImplementation(
      (_ok: PositionCallback, onError: PositionErrorCallback) => {
        onError(failure(POSITION_UNAVAILABLE))
        return 7
      },
    )

    const pending = watchBestPosition()
    await vi.advanceTimersByTimeAsync(8_000)

    await expect(pending).resolves.toEqual({ ok: false, kind: 'unavailable' })
  })

  it('times out when the browser never calls back', async () => {
    watchPosition.mockReturnValue(7)

    const pending = watchBestPosition()
    await vi.advanceTimersByTimeAsync(8_000)

    await expect(pending).resolves.toEqual({ ok: false, kind: 'timeout' })
  })

  it('honours a shorter window', async () => {
    watchPosition.mockReturnValue(7)

    const pending = watchBestPosition({ windowMs: 1_000 })
    await vi.advanceTimersByTimeAsync(1_000)

    await expect(pending).resolves.toEqual({ ok: false, kind: 'timeout' })
  })

  it('reports an unsupported browser', async () => {
    Reflect.deleteProperty(navigator, 'geolocation')

    await expect(watchBestPosition()).resolves.toEqual({ ok: false, kind: 'unsupported' })
  })
})
