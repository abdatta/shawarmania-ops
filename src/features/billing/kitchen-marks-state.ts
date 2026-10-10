import { createContext, useContext } from 'react'

import type { KitchenMarks } from '@/data-access/adapters'

/** The counter's shared kitchen marks (#72); the provider is `kitchen-marks.tsx`. */
export interface KitchenMarksState {
  marks: KitchenMarks | null
  refresh: () => Promise<void>
}

export const KitchenMarksContext = createContext<KitchenMarksState | null>(null)

/** The shared marks, or null outside a counter (where no bell is drawn). */
export function useKitchenMarks(): KitchenMarksState | null {
  return useContext(KitchenMarksContext)
}

/**
 * The kitchen is offline when the outlet has a kitchen tablet set up and none
 * of them is on shift. An outlet with no kitchen tablet is never told so.
 */
export function kitchenOffline(marks: KitchenMarks | null): boolean {
  return marks !== null && marks.kitchenTablets > 0 && marks.kitchens.length === 0
}
