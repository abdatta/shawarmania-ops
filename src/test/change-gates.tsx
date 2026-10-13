import type { ReactNode } from 'react'
import { describe } from 'vitest'

import { ChangeGatesContext } from '@/change-gates/context'
import type { ChangeGateKey } from '@/change-gates/gates'
import { ALL_OFF, type GateSnapshot } from '@/change-gates/snapshot'

/**
 * Runs a block once with a change gate off and once with it on
 * (a-release-can-be-switched-off, D10). This is how a toggle point's own tests
 * cover both states, and `npm run lint:change-gates` looks for a call naming
 * every declared gate.
 */
export function describeChangeGate(key: ChangeGateKey, body: (on: boolean) => void): void {
  for (const on of [false, true]) {
    describe(`with the ${key} change gate ${on ? 'on' : 'off'}`, () => body(on))
  }
}

/** A snapshot with the named gates on and every other off. */
export function gatesWith(on: Partial<Record<ChangeGateKey, boolean>>): GateSnapshot {
  return Object.freeze({ ...ALL_OFF, ...on })
}

/** Pins a page's gate snapshot for a component test. */
export function ChangeGatesForTest({
  on,
  children,
}: {
  on: Partial<Record<ChangeGateKey, boolean>>
  children: ReactNode
}) {
  return <ChangeGatesContext.Provider value={gatesWith(on)}>{children}</ChangeGatesContext.Provider>
}
