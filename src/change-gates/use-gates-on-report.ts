import { useChangeGate } from './context'

/**
 * Whether a tablet's minute gate answers arrive on its health report rather than
 * a read of their own (the-app-asks-the-server-less, D8): only while Tablet
 * health is on, since without it no report is sent at all.
 */
export function useGatesOnHealthReport(): boolean {
  return useChangeGate('tablet-health')
}
