import { useEffect } from 'react'

import { useAdapters } from '@/data-access'
import { ShiftRequestScreen } from '@/features/counter/shift-request-screen'
import { useCounterDevice } from '@/session/counter-context'
import type { CounterShift } from '@/session/counter-session'

import { KitchenBoardScreen } from './kitchen-board-screen'
import type { TunePlayer } from './ringer'

/** How often the kitchen tells the Tablets list it is still there. */
const HEARTBEAT_MS = 60_000

/**
 * Everything a kitchen tablet is (#70): the counter's own shift-start screen,
 * worded for the kitchen, until somebody opens a kitchen shift from their phone,
 * and then the board. No navigation, no account menu and no sign-out, for the
 * reasons the counter has none.
 *
 * It keeps the tablet's heartbeat — always reporting nothing unsent, because a
 * kitchen holds no outbox — so the Tablets list can still say *out of touch*.
 */
export function KitchenShell({
  shift,
  onShiftChanged,
  player,
}: {
  shift: CounterShift | null
  onShiftChanged: () => void
  player?: TunePlayer
}) {
  const { counter } = useAdapters()

  useEffect(() => {
    const beat = () => void counter.reportState(0, null).catch(() => undefined)
    beat()
    const timer = window.setInterval(beat, HEARTBEAT_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') beat()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [counter])

  // A kitchen shift that ends — the cutover, Leave from a phone, a type change —
  // is noticed by the handshake subscription and re-resolves the session.
  useEffect(() => {
    if (!shift) return
    const timer = window.setTimeout(
      onShiftChanged,
      Math.max(0, Date.parse(shift.expiresAt) - Date.now()),
    )
    return () => window.clearTimeout(timer)
  }, [shift, onShiftChanged])

  if (!shift) return <ShiftRequestScreen onOpened={onShiftChanged} />
  return <KitchenShiftWatch shiftId={shift.id} onEnded={onShiftChanged} player={player} />
}

/** The board, re-resolving the session the moment this shift stops being live. */
function KitchenShiftWatch({
  shiftId,
  onEnded,
  player,
}: {
  shiftId: string
  onEnded: () => void
  player: TunePlayer | undefined
}) {
  const { counter } = useAdapters()
  const deviceId = useCounterDevice().device.deviceId
  useEffect(() => {
    let active = true
    const check = () => {
      void counter
        .listLiveShifts()
        .then((shifts) => {
          if (active && !shifts.some((candidate) => candidate.id === shiftId)) onEnded()
        })
        .catch(() => undefined)
    }
    // The tablet's own shift row is what it can read; a change to it is the nudge.
    const unsubscribe = counter.subscribeToDeviceHandshake(deviceId, check)
    return () => {
      active = false
      unsubscribe()
    }
  }, [counter, deviceId, shiftId, onEnded])
  return <KitchenBoardScreen {...(player ? { player } : {})} />
}
