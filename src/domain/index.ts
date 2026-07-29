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
  billReference,
  billTotals,
  classifySync,
  lineTotalPaise,
  provisionalReference,
  provisionalToken,
  SYNC_ESCALATION_COUNT,
  SYNC_ESCALATION_MS,
  UNDO_WINDOW_MS,
  type BillLineAmounts,
  type BillTotals,
  type SyncStateKind,
} from './billing'
export {
  describeDifference,
  differencePaise,
  expectedClosingPaise,
  type CashDayInputs,
  type DifferenceKind,
} from './cash'
export {
  formatDelta,
  formatQuantity,
  isLowStock,
  movementDelta,
  QUANTITY_DECIMALS,
  roundQuantity,
  sumQuantities,
  type MovementType,
} from './inventory'
export {
  formatBusinessDate,
  formatDate,
  formatDateTime,
  formatTime,
  OUTLET_TIME_ZONE,
  resolveBusinessDate,
  shiftBusinessDate,
} from './datetime'
export {
  captureQuality,
  CAPTURE_ACCURACY_GOOD_M,
  CAPTURE_ACCURACY_MAX_M,
  distanceMetres,
  evaluateFence,
  formatMetres,
  type Coordinates,
  type CaptureQuality,
  type FenceReference,
  type FenceVerdict,
} from './geo'
export { formatPaise, NotPaiseError, paiseToRupees, rupeesToPaise } from './money'
export {
  cashBasisProfitPaise,
  consumptionBasisProfitPaise,
  inventoryConsumedPaise,
  nonRawMaterialExpensesPaise,
  profitEstimate,
  PROFIT_BASIS_DESCRIPTIONS,
  PROFIT_BASIS_LABELS,
  rawMaterialExpensesPaise,
  RAW_MATERIALS_CATEGORY,
  totalExpensesPaise,
  type ConsumedMovement,
  type ExpenseAmount,
  type ProfitBasis,
  type ProfitEstimate,
  type ProfitInputs,
} from './pnl'
export {
  ALERT_PRIORITY_ORDER,
  ALERT_STATUS_LABELS,
  alertAttentionRank,
  canTransition,
  nextStatuses,
  type AlertPriority,
  type AlertStatus,
} from './alerts'
