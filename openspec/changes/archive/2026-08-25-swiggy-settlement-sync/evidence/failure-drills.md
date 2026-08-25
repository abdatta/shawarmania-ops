# 9.6 failure rehearsals (2026-08-24)

Live drills against production (money untouched in every case):
- **Session lapse**: forged dead access token via reader env override ->
  `SESSION_LAPSED: Swiggy rejected the session`, exit 1, zero writes,
  no browser or OTP attempt.
- **Payout mismatch**: rolled-out direct RPC with a settled candidate whose
  stated payout exceeds computed by Rs 521143 -> outcome
  `reconciliation_failed` (computed 19305 vs stated 540448); the disputed
  marking touched only provisional days, of which none existed for the fake
  cycle; the drill's dispute row was deleted afterwards.
- **Unmapped RID**: restaurant_ref 99999999 -> refused before any write with
  `restaurant 99999999 is not mapped for channel swiggy`.

Transport classes - bounded 408/429/5xx retry exhaustion, network timeout,
GraphQL error bodies, pagination cursor repetition and page-cap refusal,
source-shape drift - are pinned by the sync repository unit suite
(npm run test:swiggy, 23 passing), which asserts the classification and the
no-write guarantee for each class.
