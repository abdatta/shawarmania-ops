import { createContext, useContext } from 'react'

/**
 * How a walkthrough starts again.
 *
 * The demo store is built per demo-tree mount, so a reset is a remount — there
 * is no undo machinery to maintain, and "demo state resets" stays true because
 * it is the same mechanism that made it true in the first place
 * (`docs/DEMO_MODE.md`).
 *
 * A context rather than a prop threaded through two shells: the control lives in
 * the demo banner, which the shells receive as an opaque slot and must not learn
 * anything about.
 */
export const DemoResetContext = createContext<(() => void) | null>(null)

/** Null outside the demo tree, which is the honest answer there. */
export function useDemoReset(): (() => void) | null {
  return useContext(DemoResetContext)
}
