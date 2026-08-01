import type { Session, SessionMode } from '@/session/session'

/**
 * Which outlet an outlet-scoped surface opens on, remembered between them
 * (owner-reaches-every-outlet, design D6).
 *
 * Until this change the choice lived in component state, by decision D6 of
 * `multi-outlet-people`: it did not outlive the surface, on purpose. That was
 * right when it meant a two-outlet manager and one screen. It is wrong now that
 * the owner reaches four surfaces at every outlet and re-answers the same
 * question on each of them, so the half of that decision about *convenience* is
 * reversed here and recorded (design D7).
 *
 * **The half that mattered is untouched.** This is a filter, not session state:
 * there is no active outlet, no "acting as", and it confers nothing. Every write
 * is decided by the database from the assignment, so a remembered outlet the
 * person may not write at is refused exactly as a freshly chosen one would be.
 *
 * Three properties the storage itself has to carry:
 *
 *   * **Namespaced by person**, because these are phones that get handed over. A
 *     key shared by every user would open the next person on the last person's
 *     shop, and on a counter tablet that is somebody else's takings.
 *   * **Namespaced by mode**, so a demonstrator's choice cannot leak into a real
 *     session — the same separation the demo has everywhere else.
 *   * **Silent when storage refuses.** A browser in private mode can throw on
 *     read and on write. The surface's job is to open on an outlet, not to
 *     report a storage problem, so a failure degrades to the old behaviour of
 *     defaulting every time.
 */

const PREFIX = 'shawarmania.outlet-scope'

function keyFor(mode: SessionMode, userId: string): string {
  return `${PREFIX}.${mode}.${userId}`
}

/** Storage as an optional capability, which is what it is in a browser. */
function store(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/**
 * The outlet this person last chose, or null.
 *
 * Never trusted on its own: the caller checks it against the outlets that person
 * may currently see, because an outlet can close, be deleted, or stop being
 * theirs between one visit and the next.
 */
export function readRememberedOutlet(session: Session): string | null {
  try {
    return store()?.getItem(keyFor(session.mode, session.userId)) ?? null
  } catch {
    return null
  }
}

/** Remember this outlet for this person, or forget it when it is null. */
export function rememberOutlet(session: Session, outletId: string | null): void {
  const key = keyFor(session.mode, session.userId)
  try {
    if (outletId === null) store()?.removeItem(key)
    else store()?.setItem(key, outletId)
  } catch {
    // A refused write means the next visit defaults, which is what it used to do.
  }
}

/**
 * Forget every remembered outlet on this device.
 *
 * Called when a session ends rather than when one begins, and deliberately not
 * scoped to the person signing out: a shared phone should hand the next person
 * nothing, including a stale key left by somebody who never signed out properly.
 */
export function forgetRememberedOutlets(): void {
  const storage = store()
  if (!storage) return
  try {
    const keys: string[] = []
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index)
      if (key?.startsWith(PREFIX)) keys.push(key)
    }
    for (const key of keys) storage.removeItem(key)
  } catch {
    // Nothing to do about it, and nothing that depends on it having worked.
  }
}
