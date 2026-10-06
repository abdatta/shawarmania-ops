## 1. Data

- [x] 1.1 `fixtures/menu.ts`: Kalyani Cafe's sixty items in ten categories, veg markers, descriptions; the seven old items first with their ids; `cheese` and `lebanese` keys.
- [x] 1.2 `fixtures/outlets.ts`: Kalyani takes the owner's Orders and Loyalty settings; Kanchrapara unchanged.
- [x] 1.3 `fixtures/billing.ts`: the demo day's discounted sale is three Cheese, so its round-up still has paise to round.

## 2. Tests

- [x] 2.1 `demo-outlet-settings.test.ts` pins Kalyani's settings to the owner's screens.
- [x] 2.2 Re-derived from the new prices: `menu.test.ts`, `menu-surface.test.tsx`, `billing-counter.test.tsx`, `manager-billing-history.test.tsx`, `e2e/counter.spec.ts`, `e2e/operations.spec.ts`.
- [x] 2.3 Tests about something else start from nothing chosen, explicitly: `outlet-service-sections.test.tsx` and `e2e/counter.spec.ts` (`openCounterWithNothingChosen`).
- [x] 2.4 `e2e/counter.spec.ts`: a takeaway rung as the shop does it, and the pinned menu search over a column the real menu overflows (deferred from `billing-menu-search`).

## 3. Docs

- [x] 3.1 `docs/DEMO_MODE.md` walkthrough and `docs/BUSINESS_CONTEXT.md` menu.

## 4. Gate

- [x] 4.1 **Gate**: the proposal's gate; run locally on 2026-10-06: `lint`, `format:check`, `typecheck`, `contrast`, `build` and `test:e2e` (304 passed, phone, tablet and desktop) green; `npm test` green but for `scripts/check-encoding.test.mjs`'s two Windows-1252 cases, which fail identically before this change in this container. Screenshots of the demo counter with the real menu, light and dark, sent to the owner; no console errors and no request off the app's origin.
