import { MenuActionError, type MenuAdapter } from '../adapters'

/**
 * The real menu adapter — **deliberately not connected yet**.
 *
 * `DataAdapters` is a total bag, so the real tree has to supply a `menu` today;
 * the menu surfaces themselves are `demo`-gated and never mount against it. The
 * change that makes them real is `expenses-and-inventory-live` (#11) for the
 * manager's side and `billing-live` (#10) for the counter's, and each replaces
 * this file with actual queries against `menu_categories` / `menu_items`.
 *
 * Writing those queries now would ship code no gate in this change can exercise
 * — which is precisely how a `*-live` change discovers its adapter was wrong.
 * So the reads answer honestly (a real outlet has no menu rows yet) and the
 * writes refuse in this app's voice rather than throwing something raw.
 *
 * It takes no client for the same reason: there is nothing yet to query.
 */
export function createSupabaseMenuAdapter(): MenuAdapter {
  const notLive = () =>
    Promise.reject(
      new MenuActionError(
        'not_live',
        'The menu is not connected to real data yet. It is being demonstrated first.',
      ),
    )

  return {
    async listMenu() {
      return []
    },
    createCategory: notLive,
    updateCategory: notLive,
    createItem: notLive,
    updateItem: notLive,
    setItemAvailability: notLive,
  }
}
