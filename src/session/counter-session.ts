/**
 * The counter tablet's session, which is not a person's.
 *
 * `Session` in `./session.ts` describes somebody: a name, assignments, roles
 * they hold and roles they reach. None of that is true of a tablet. It has an
 * outlet because it is bolted to one counter, and it has a shift only while
 * somebody has opened one on it, and that is the entire contract.
 *
 * Kept as a separate type rather than a third `mode` on `Session`, deliberately.
 * A third mode would mean every `session.assignments` read in the app becoming a
 * question the tablet has no answer to, and the answers people reach for when a
 * type forces them — an empty array, a null role — are exactly the shape that
 * makes a machine look like a person with nothing filled in. Two types cannot be
 * confused by accident; the compiler refuses.
 */

/** The hardware, as the database knows it. Present from setup until removal. */
export interface CounterDevice {
  deviceId: string
  outletId: string
  /** What an admin called this tablet when they set it up. */
  label: string
}

/** Who is standing at it, for which trading day. */
export interface CounterShift {
  id: string
  personId: string
  outletId: string
  openedAt: string
  /** Resolved from the outlet's cutover when the shift opened, then frozen. */
  businessDate: string
  /** The outlet's next cutover. A shift is live only while this is ahead. */
  expiresAt: string
}

/**
 * A set-up tablet, with or without somebody on it.
 *
 * `shift: null` is the ordinary resting state, not an error: it is what the
 * counter looks like between the end of one evening and the start of the next,
 * and it is the state the shift-request screen exists for.
 */
export interface CounterDeviceSession {
  kind: 'counter-device'
  device: CounterDevice
  shift: CounterShift | null
}

/** Is somebody on the counter right now? */
export function hasLiveShift(
  session: CounterDeviceSession,
): session is CounterDeviceSession & { shift: CounterShift } {
  return session.shift !== null
}
