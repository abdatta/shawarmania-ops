import { createContext, useContext } from 'react'

import type { ChangeGateKey } from './gates'
import { ALL_OFF, type GateSnapshot } from './snapshot'

/**
 * How a page's change-gate snapshot reaches its toggle points.
 *
 * The real app provides the snapshot it booted with, above the router; the demo
 * tree provides its own over it. Outside any provider every gate reads off,
 * which is the honest answer for a component rendered on its own in a test.
 */
export const ChangeGatesContext = createContext<GateSnapshot>(ALL_OFF)

/** Whether a change is applied on this page. Fixed until the page reloads. */
export function useChangeGate(key: ChangeGateKey): boolean {
  return useContext(ChangeGatesContext)[key]
}

/** Every gate at once: for the build stamp's codes and the health report. */
export function useChangeGateSnapshot(): GateSnapshot {
  return useContext(ChangeGatesContext)
}
