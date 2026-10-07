# Tasks: the-menu-asks-for-a-review

## 1. Database

- [x] 1.1 Add `review_ask_enabled`, `review_ask_url`, `review_ask_percent` to `outlets` with the three check constraints, off by default.
- [x] 1.2 Add `set_outlet_review_ask`, owner or this outlet's Franchise Admin only, writing those three columns only.
- [x] 1.3 Return `review` (`{url, percent}` or null) from `public_menu`, keeping #68's sections and the service-role-only grant.
- [x] 1.4 Turn it on for `kalyani-cafe` with its listing's review link and five percent; no other outlet is touched.
- [x] 1.5 pgTAP `78_the_menu_asks_for_a_review.sql`: defaults, every constraint, owner/manager/other-manager/staff/anon reach, the reader's on/off answer.

## 2. App

- [x] 2.1 `OutletReviewAsk` and `reviewAskProblem` in the domain, mirroring the constraints; unit tests.
- [x] 2.2 `getReviewAsk` / `updateReviewAsk` on the outlets adapter, mock and live; regenerate schema types; fixtures typed from them.
- [x] 2.3 The **Google review** section on the outlet page, with its shimmer, read-only form and `outlet-review-ask` live part; component tests.
- [x] 2.4 Inspect the section in both themes in demo mode.

## 3. Release — Worker first

- [ ] 3.1 Deploy the brand site's Worker that accepts `review` (shawarmania `npm run worker:deploy`).
- [ ] 3.2 Push this change; the Deploy workflow migrates production. Not so close to 00:00 UTC (05:30 IST) that the gate's auth e2e step runs across it: the two-till table test still fails on a run that crosses UTC midnight.
- [ ] 3.3 Open `shawarmania.in/menu/kalyani-cafe/` and confirm the popup, then change the percentage on the outlet page and see it on the menu within a minute.
