import { ChevronDown, Locate, MapPin, MapPinOff, Navigation, SignalZero } from 'lucide-react'
import { useEffect, useState, type ComponentType } from 'react'

import { OUTLET_KALYANI_ID, outletFixtures } from '@/data-access/mock/fixtures/outlets'
import { standInGeolocation } from '@/lib/geolocation'
import { useSession } from '@/session/context'

/**
 * Where the demo says a phone is when it checks in
 * (a-check-in-at-the-shop-approves-itself, demo): at the shop, away from it,
 * with location off or with no signal, or the device's own reading. Without
 * it, the cases the check-in screens draw for are only reachable by walking
 * somewhere, and a phone on the demo's plain-http address has no location at
 * all.
 *
 * The same pill as the counter's connectivity control and the Waiter's
 * location (#80) beside it, and a sibling of the Waiter's rather than a reuse:
 * that one sets the Waiter's presence record, this one stands in for the
 * reading the phone itself gives, through `standInGeolocation`, so every
 * screen that reads a position meets it exactly as it would a real phone.
 *
 * Shown to the two roles that check in, and installed only while shown:
 * leaving the demo, or switching to a role that never reads a position, puts
 * the device's own location back.
 */

type Place = 'device' | 'shop' | 'away' | 'off' | 'no-signal'

const PLACES: Record<
  Place,
  { label: string; icon: ComponentType<{ size?: number; className?: string }> }
> = {
  device: { label: 'This device’s location', icon: Navigation },
  shop: { label: 'At the shop', icon: MapPin },
  away: { label: 'Away from the shop', icon: Locate },
  off: { label: 'Location off', icon: MapPinOff },
  'no-signal': { label: 'No location signal', icon: SignalZero },
}

const PLACE_STATES = Object.keys(PLACES) as Place[]

/** Long enough to see a button spin, short enough not to wait for. */
const READING_MS = 1_200

const shop = outletFixtures.find((outlet) => outlet.id === OUTLET_KALYANI_ID)!

/** About 2.4 km north of the shop: plainly away, not a fence-edge case. */
const AWAY_LATITUDE_DEGREES = 0.022

function failure(code: 1 | 3): GeolocationPositionError {
  return {
    code,
    message: code === 1 ? 'User denied Geolocation' : 'Timeout expired',
    PERMISSION_DENIED: 1,
    POSITION_UNAVAILABLE: 2,
    TIMEOUT: 3,
  }
}

function position(latitude: number, longitude: number, accuracy: number): GeolocationPosition {
  const coords = {
    latitude,
    longitude,
    accuracy,
    altitude: null,
    altitudeAccuracy: null,
    heading: null,
    speed: null,
  }
  return {
    coords: { ...coords, toJSON: () => coords },
    timestamp: Date.now(),
    toJSON: () => ({ coords, timestamp: Date.now() }),
  }
}

/** A phone that answers every reading from `place`, after a moment. */
function standIn(place: Exclude<Place, 'device'>): Geolocation {
  const timers = new Map<number, ReturnType<typeof setTimeout>>()
  let next = 1
  const answer = (success: PositionCallback, error?: PositionErrorCallback | null) => {
    const id = next++
    timers.set(
      id,
      setTimeout(() => {
        timers.delete(id)
        if (place === 'shop') success(position(shop.latitude!, shop.longitude!, 12))
        else if (place === 'away')
          success(position(shop.latitude! + AWAY_LATITUDE_DEGREES, shop.longitude!, 20))
        else error?.(failure(place === 'off' ? 1 : 3))
      }, READING_MS),
    )
    return id
  }
  const clear = (id: number) => {
    clearTimeout(timers.get(id))
    timers.delete(id)
  }
  return {
    getCurrentPosition: (success, error) => void answer(success, error),
    watchPosition: (success, error) => answer(success, error),
    clearWatch: clear,
  }
}

/** The banner's place control, on the two roles that check in. */
export function DemoCheckInPlace() {
  const session = useSession()
  const [place, setPlace] = useState<Place>('device')
  const checksIn = session?.role === 'employee' || session?.role === 'franchise_admin'

  useEffect(() => {
    if (!checksIn || place === 'device') return
    standInGeolocation(standIn(place))
    return () => standInGeolocation(null)
  }, [checksIn, place])

  if (!checksIn) return null
  const Icon = PLACES[place].icon
  return (
    <span
      data-testid="demo-check-in-place"
      className="relative flex shrink-0 items-center rounded bg-on-warning/15 has-[:focus-visible]:focus-ring"
    >
      <span
        aria-hidden
        className="flex items-center gap-1 px-1.5 py-1 text-xs font-semibold sm:gap-0.5 sm:px-2"
      >
        <Icon size={14} className="shrink-0" />
        <span className="hidden sm:inline">{PLACES[place].label}</span>
        <ChevronDown size={12} className="hidden sm:inline-block" />
      </span>
      <select
        aria-label="Demo phone location"
        value={place}
        onChange={(event) => setPlace(event.target.value as Place)}
        className="absolute inset-0 h-full w-full cursor-pointer appearance-none border-0 bg-transparent p-0 text-transparent outline-none"
      >
        {PLACE_STATES.map((state) => (
          <option key={state} value={state} className="bg-surface text-content">
            {PLACES[state].label}
          </option>
        ))}
      </select>
    </span>
  )
}
