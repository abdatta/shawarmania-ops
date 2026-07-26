/**
 * Domain layer — pure functions only. No I/O, no React, no imports from any
 * other layer (enforced by eslint.config.js).
 *
 * This is where money correctness is proven: totals, expected closing cash,
 * business-date resolution, P&L and geofence distance all land here as
 * functions over plain values, because the rules most expensive to get wrong
 * should be the rules easiest to test.
 */

export {
  formatBusinessDate,
  formatDate,
  formatDateTime,
  formatTime,
  OUTLET_TIME_ZONE,
} from './datetime'
export { formatPaise, NotPaiseError, paiseToRupees, rupeesToPaise } from './money'
