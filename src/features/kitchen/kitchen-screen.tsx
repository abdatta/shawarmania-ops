import { DishKitchenBoardScreen } from './dish-kitchen-board-screen'
import type { TunePlayer } from './ringer'

/**
 * The kitchen screen this page runs: the dish board (each-dish-is-ticked-off,
 * design R7). The kitchen as it was before #74 was retired with `dish-ticks`.
 */
export function KitchenScreen({ player }: { player?: TunePlayer }) {
  return <DishKitchenBoardScreen {...(player ? { player } : {})} />
}
