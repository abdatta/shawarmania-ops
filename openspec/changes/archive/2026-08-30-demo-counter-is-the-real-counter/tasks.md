## 1. The demo moves onto `counter_shifts`

- [x] 1.1 Replace `DemoStore.shifts` (`Tables<'shifts'>`) with `Tables<'counter_shifts'>`: `person_id`, `device_id`, `ended_at` + `ended_reason` and `expires_at` in place of `biller_profile_id`, `counter_device_id` and `closed_at`. Seed the open Kalyani shift and the closed Kanchrapara one in the new shape, with `expires_at` at the outlet's next cutover.
- [x] 1.2 Point every demo bill, order and billing command at `counter_shift_id`, leaving `shift_id` null as production does. Fix `created_shift_id`, `paid_shift_id` and `cancelled_shift_id`, which currently hold `shifts` ids in columns that reference `counter_shifts`.
- [x] 1.3 Make the one table the one fact: `listLiveShifts`, `readDeviceOperations`, the demo tablet session and billing attribution all read it. `confirmShift` closes any open row for that device and inserts one for the confirming persona; `endShift` closes with `operator`; Finish day closes with `day_finished`.
- [x] 1.4 Resolve a demo shift's business date and `expires_at` through the outlet's `business_day_cutover` rather than the device clock, matching the rest of the store.
- [x] 1.5 Scope `openShiftRow()` in the mock billing adapter to the counter's device and outlet, so a second outlet's open shift is never mistaken for this counter's.
- [x] 1.6 Add mock unit coverage: Tablets and `listLiveShifts` agree; a confirmed handshake opens a shift billing attributes to; Leave counter and Finish day close the shift every surface is reading, with distinguishable end reasons; a second outlet's shift is ignored; an after-cutover walkthrough dates its shift correctly.
- [x] 1.7 Prove no figure moved across the migration: the drawer, cash, shift totals, manager history, alerts, the manual ledger and the owner console report exactly what they reported before it.

## 2. The demo mounts the real tablet

- [x] 2.1 Add a demo-owned counter host that builds a synthetic `CounterDeviceSession` from the demo's Kalyani device and the store's open shift, provides it through `CounterDeviceContext`, and re-resolves it on `onShiftChanged`. It must import no Supabase client and no real adapter.
- [x] 2.2 Render the real `src/features/counter/counter-shell.tsx` for the Biller persona in `DemoRoot`, with the demo banner and its role switcher above it, and decide on the evidence whether a delivery runtime is mounted (record the decision in the host's own comment).
- [x] 2.3 Retire the Biller's `counter-home` and `counter-expenses` navigation entries in `src/gates/registry.ts`, keeping `counter-billing`, `counter-my-shift` and `counter-open-orders` `live` and route-reachable, and `counter-shift-unlock` `hidden`. Record why in the registry's own voice.
- [x] 2.4 Prove the safety rail still holds: `src/demo/demo-safety.test.tsx` and the eslint boundary pass unchanged, and `src/demo/demo-reset.test.tsx` still restores the scenario from the counter.

## 3. The after-departure exception joins the scenario

- [x] 3.1 Promote an existing Kalyani bill on today's business date to carry `recorded_after_shift_end` and `attribution_shift_ended_at`, choosing one whose paid time can honestly sit after a remote departure. Record in the seed comment which bill was promoted and why, and change nothing else about it.
- [x] 3.2 Prove no money moved: the drawer, cash, manager history and the owner console report exactly what they reported before the promotion. The departed shift's own totals do change, and must — excluding the flagged bill from the incoming operator's shift is the contract, not a regression.
- [x] 3.3 Add coverage for the manager review in demo: the flagged bill is labelled, all three outcomes are walkable, the review appends without rewriting the original attribution, and the incoming operator is given no alert.

## 4. The counter column the demo exposed

Found by mounting the real tablet in the demo, and a production bug rather than a
demo one: with a busy shift the middle column ran off the bottom of the screen
with no way to scroll, so the last bills and any needs-attention card became
unreachable mid-service.

- [x] 4.1 Give the embedded shift column a fixed head and a scrolling body: the day's Cash and UPI totals stay pinned, and the bills and attention cards scroll together beneath them.
- [x] 4.2 Move needs-attention cards above the bill list. A refused payment is the reason the takings are wrong, not a footnote to them, and it was sitting beneath every bill of the evening.
- [x] 4.3 Add coverage that the column scrolls rather than overflowing, that the totals do not move with it, and that an attention card precedes the bills.

## 5. Tests, documentation and verification

- [x] 5.1 Rework `e2e/counter.spec.ts` and `e2e/operations.spec.ts` for the tablet-shaped demo Biller. Rewrite the absent-navigation assertions at `:496-497` and `:543` to say what they now mean rather than deleting them, and keep proving the legacy PIN surface is gone.
- [x] 5.2 Add browser coverage for the states the demo could not previously reach: the no-shift resting state, asking for a shift, the four digits, three wrong codes, Hand over, Leave counter from a phone, and Finish day with a blocker and then with none.
- [x] 5.3 Update `docs/DEMO_MODE.md` — make the shift-screen and handshake bullets true, rewrite the Biller section of the walkthrough around one screen, and place the Finish Day, Leave counter and attribution-review scenes in it. Update `docs/SCREENS.md` (the demo Biller is no longer a tab shell) and `docs/TESTING.md`.
- [x] 5.4 Run focused tests, then `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run contrast`, `npm run build`, and `npm run test:e2e`; fix and repeat until green.
- [x] 5.5 Walked by hand at 1280x800: landed on the tablet (device-named header, Hand over, Finish day, expenses inline), the banner stayed pinned while the page scrolled, Finish day named both blockers with their resolutions, the shift column scrolled beneath pinned totals with attention first, and the flagged bill opened in manager history with all three review outcomes. **Not walked by hand:** finishing the day through to the request screen, the four-digit approval from a second role, and light theme — all three are covered by the browser suites, which render both themes with no console errors.
- [x] 5.6 PHASE GATE — the Gate is proved literally. `/demo/biller` mounts `src/features/counter/counter-shell.tsx`, the same file `/counter` mounts. One shift reads the same across the counter, Tablets, every phone's live-shift card and billing attribution, pinned by `src/data-access/mock/counter.test.ts`. The attribution review is walkable over Bill 18, which stays in the day's ₹3,711 cash while Priya's shift correctly reads ₹3,294 without it.

  Gates run: lint (0 errors, 12 pre-existing warnings), formatting, typecheck, 1,613 unit tests, 254 browser tests, 2,154 database tests, REST/RLS suites, 21 auth E2E tests, 52 contrast pairs across both themes, production build, and generated database types current.

  **Not run:** `npm run functions:typecheck` — Deno is installed but off the shell PATH, and no Edge Function changed in this change.
