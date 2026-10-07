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
  discountAmountPaise,
  isCorrectableRefusal,
  lineTotalPaise,
  menuLineDiscount,
  AWAITING_ORDER_NUMBER,
  isAwaitingOrderNumber,
  UNSENT_ORDER_REFERENCE,
  ticketEditDeadlineMs,
  MINIMUM_BILL_PAISE,
  PAYMENT_EDIT_WINDOW_MS,
  SYNC_ESCALATION_COUNT,
  SYNC_ESCALATION_MS,
  type BillLineAmounts,
  type BillTotals,
  type BillingCommandRefusal,
  type BillingCommandResult,
  type DiscountBasis,
  type DiscountRule,
  type LineDiscount,
  type MenuDiscountRule,
  type SyncStateKind,
  type TicketEditFacts,
} from './billing'
export {
  describeDifference,
  differencePaise,
  expectedClosingPaise,
  type CashDayInputs,
  type DifferenceKind,
} from './cash'
/**
 * The drawer as a continuous balance (#11). Deliberately duplicates two
 * two-line functions from `./cash` rather than importing them: `cash.ts` and
 * `daily_cash_records` are left dead in place by decision 16 and dropped by
 * #12, and the live drawer must survive that without an edit.
 */
export {
  APPROXIMATE_WINDOW_MINUTES,
  describeDrawerDifference,
  drawerDifferencePaise,
  exactCoincidence,
  expectedTotalPaise,
  isInInterval,
  nextOpeningPaise,
  toleranceThroughputPaise,
  type BillRunCoincidence,
  type DrawerDifferenceKind,
  type DrawerIntervalInputs,
  type NearbyCashBill,
} from './drawer'
export { DELIVERY_CHANNELS, isDeliveryChannel, type DeliveryChannel } from './channels'
export {
  readMonth,
  type MonthCategoryTotal,
  type MonthChannelDay,
  type MonthChannelTotal,
  type MonthDayInput,
  type MonthExpenseLine,
  type MonthReading,
} from './ledger-month'
export {
  describeCutover,
  earliestOffered,
  formatBusinessDate,
  formatBusinessDateShort,
  formatDate,
  formatDateTime,
  formatDayTime,
  formatFreshness,
  formatRecentAge,
  formatTime,
  instantOnBusinessDay,
  OUTLET_TIME_ZONE,
  QUIET_HOURS_FROM,
  QUIET_HOURS_UNTIL,
  resolveBusinessDate,
  shiftBusinessDate,
  carryPeriod,
  TRADING_SESSION,
  type CutoverAdvice,
  type CutoverFiling,
  type CutoverSample,
  type TradingMoment,
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
export { COUNTER_TELEMETRY_FRESH_MS, isCounterTelemetryFresh } from './counter-telemetry'
export { normalizeCategory, reservedCategoryConflict } from './expense-category'
export {
  foldCategory,
  matchCategory,
  type CategoryMatch,
  type CategoryMatchReason,
} from './category-match'
export {
  groupMenuDiscounts,
  menuDiscountLabel,
  type DiscountedLine,
  type MenuDiscountGroup,
} from './discount-rows'
export {
  CUSTOMER_SEARCH_MIN_DIGITS,
  CUSTOMER_SEARCH_MIN_LETTERS,
  customerMatchStrength,
  highlightName,
  highlightPhone,
  parseCustomerQuery,
  type CustomerQuery,
  type MatchSegment,
} from './customer-search'
export {
  ALL_OFF_SERVICE_SETTINGS,
  busyTables,
  capturePackaging,
  initialServiceType,
  isPackagingLine,
  isWaivedPackaging,
  lineKey,
  PACKAGING_LINE_KEY,
  MAX_TABLE_NUMBER,
  isTableNumber,
  MIN_PACKAGING_PRICE_PAISE,
  offeredServiceTypes,
  ordersOffered,
  PACKAGING_LINE_NAME,
  packagingApplies,
  packagingLine,
  packagingWaived,
  SERVICE_SETTINGS_PROBLEM_MESSAGES,
  serviceChoiceRequired,
  serviceChoiceShown,
  serviceSettingsProblem,
  serviceTypeLabel,
  sharedTables,
  tableLabel,
  tablesOffered,
  withOrdersSwitched,
  withPackagingSwitched,
  type CapturedPackaging,
  type LineKind,
  type OutletServiceSettings,
  type PackagingMode,
  type ServiceSettingsProblem,
  type ServiceType,
  type SharedTable,
} from './service'
export {
  ALL_OFF_LOYALTY_SETTINGS,
  DEFAULT_GOLD_DURATION_MONTHS,
  DEFAULT_GOLD_THRESHOLD_PAISE,
  DEFAULT_GOLD_USE_CAP_BP,
  DEFAULT_POINTS_RULES,
  earnBasisPaise,
  earnRate,
  GOLD_WINDOW_DAYS,
  goldEligible,
  goldEndsAt,
  goldInForce,
  LOYALTY_SETTINGS_PROBLEM_MESSAGES,
  loyaltySettingsProblem,
  MAX_GOLD_DURATION_MONTHS,
  MAX_GOLD_MULTIPLIER_X100,
  multiplierLabel,
  POINT_VALUE_PAISE,
  pointsEarned,
  pointsLabel,
  pointsRowTitle,
  pointsUsableMax,
  SAME_RATE_X100,
  withCounterGoldSwitched,
  withGoldSwitched,
  withPointsSwitched,
  type EarnRate,
  type LoyaltySettingsProblem,
  type OutletLoyaltySettings,
} from './loyalty'
export {
  DEFAULT_REVIEW_ASK,
  MAX_REVIEW_PERCENT,
  MIN_REVIEW_PERCENT,
  REVIEW_ASK_PROBLEM_MESSAGES,
  REVIEW_URL_MAX_LENGTH,
  REVIEW_URL_PATTERN,
  reviewAskProblem,
  type OutletReviewAsk,
  type ReviewAskProblem,
} from './review-ask'
