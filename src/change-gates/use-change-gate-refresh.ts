import { useEffect } from 'react'

import type { ChangeGatesAdapter } from '@/data-access/adapters'

import { startChangeGateRefresh } from './refresh'

/**
 * Keeps this device's change-gate answers current for as long as a real root is
 * mounted (D6). The phone, the counter and the kitchen each run one; the demo
 * does not, because its gates live in the demo's own state.
 */
export function useChangeGateRefresh(adapter: ChangeGatesAdapter | null | undefined): void {
  useEffect(() => {
    if (!adapter) return
    return startChangeGateRefresh(adapter)
  }, [adapter])
}
