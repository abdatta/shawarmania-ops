# Tasks: the-order-number-arrives-when-it-arrives

> **The words do not disappear, they move.** `counter-billing` requires a surface
> to state plainly that work is not sent yet. This change keeps that and puts the
> statement in the sync indicator — always on screen, counting exactly the cards
> that are shimmering — instead of on every card. Deleting the card text without
> the delta saying so would look like the rule was forgotten.

## 1. The Shimmer, And The Token That Goes With It

- [x] 1.1 Write the failing test first: a pipeline card for an order awaiting its number shows a shimmer in the badge and no `Local ·` text. It fails today against every queued order.
- [x] 1.2 Name the sentinel. Both adapters already say `orderNumber: 0` for a queued order; give it a domain predicate so the magic number is not repeated at five call sites, and delete `provisionalToken`, `provisionalReference`, the Crockford alphabet and their tests.
- [x] 1.3 Remove `BillingOrder.localReference` and every construction of it in the mock and the real adapter. The field only ever carried the token.
- [x] 1.4 The pipeline card's number badge and the open-order card's reference chip render a `Shimmer` **sized to the number that is arriving**, per the standing rule that a placeholder reserves the shape of what it replaces.
- [x] 1.5 `Shimmer` is `aria-hidden`, so add `sr-only` text saying the number has not been assigned yet. Without it the badge is simply absent for anyone not looking at the screen.
- [x] 1.6 Prose and accessible names that interpolated the token — *More actions for …*, *Items for …*, *Cancel order …*, *Editing …* — name an unsent order in words. Keep the existing wording for a numbered order so nothing else moves.
- [x] 1.7 Update the e2e assertions that pin the token today, including the `open-order-local-` test id, which keys off the field being removed.
- [x] 1.8 SECTION GATE — `npm run typecheck`, `npm run lint`, `npm run format:check`, the touched test files, and `npm run test:e2e`. Then place an order at `/demo` and watch the badge: a shimmer, then the number, and no token in between.

## 2. The Delta, And The Rule It Moves

- [x] 2.1 Write the `counter-billing` delta: the card shows no reference and no number until one exists, and the surface states the unsent condition **once**, in the sync indicator. Say that the words moved rather than went, or the next reader will read it as the rule being dropped.
- [x] 2.2 Narrow the queued-bill requirement to what the product actually does. The `Queued · XXXX` helper it was written for is used by no surface, so the requirement has never been implemented; leaving it as written would keep describing a reference that does not exist.
- [x] 2.3 One docs line where the fix implies a rule: an unsent thing is drawn as the shape of what is coming, and said in words once, by the shell.
- [x] 2.4 PHASE GATE — an order placed at the counter shows a shimmer where its number will be and never a token that reads as one; the number replaces it on delivery; the sync indicator carries the plain words about unsent work; and the four-role demo walkthrough still walks. **Verified 2026-09-22**: the full suite green — typecheck, all eight lints, edge-function types, 1807 unit tests, contrast, build, 284 e2e including `demo.spec.ts`'s four-role walk — and the same suite green in CI on `1d596dc`, the commit now in production. `pipeline-card-number.test.tsx` pins the shimmer's shape, its `sr-only` words and the absence of any interpolated token. **And production has run on it**: live since 2026-09-21 02:55 IST, one full trading day, 38 orders at Kalyani, every one carrying a distinct sequential number, no duplicate on any day since 09-14 and no void.
