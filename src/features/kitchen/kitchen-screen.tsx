import { useChangeGate } from '@/change-gates/context'

import { DishKitchenBoardScreen } from './dish-kitchen-board-screen'
import { KitchenBoardScreen } from './kitchen-board-screen'
import type { TunePlayer } from './ringer'

/**
 * Which kitchen screen this page runs (each-dish-is-ticked-off, design R7): the
 * dish ticks' board, or the kitchen as it was before #74. Decided once, from
 * the page's frozen gate snapshot; a turned gate arrives by the next reload.
 */
export function KitchenScreen({ player }: { player?: TunePlayer }) {
  const dishTicks = useChangeGate('dish-ticks')
  return dishTicks ? (
    <DishKitchenBoardScreen {...(player ? { player } : {})} />
  ) : (
    <KitchenBoardScreen {...(player ? { player } : {})} />
  )
}
