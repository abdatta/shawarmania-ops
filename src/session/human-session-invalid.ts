type HumanSessionInvalidListener = () => void

const listeners = new Set<HumanSessionInvalidListener>()

/**
 * Announce a definitive server rejection of the current human credential.
 * Transport uncertainty and authorization refusals must never call this.
 */
export function signalHumanSessionInvalid(): void {
  for (const listener of listeners) listener()
}

/** Real human session resolution is the sole consumer. Demo never imports it. */
export function onHumanSessionInvalid(listener: HumanSessionInvalidListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
