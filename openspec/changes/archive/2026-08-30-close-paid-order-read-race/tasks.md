# Tasks

## 1. Name the projection

- [x] Lift the envelope-overlay loop out of `readOrders` in
      `src/data-access/supabase-adapters/billing.ts` into one function that takes
      a server snapshot plus this outlet's local envelopes and returns what the
      tablet believes, replaying every command type it handles today.
- [x] Leave the `state !== 'needs_attention'` exclusion exactly as it is: a
      refused command did not happen, and that is already correct.

## 2. Reverse the two reads

- [x] Read the outbox envelopes before the server `orders` snapshot in
      `readOrders`, and compose through the function from task 1.
- [x] Check `readBills` and `overlayDurableBills` for the same two-read shape
      and reverse them on the same reasoning if they have it, or record in the
      change why they do not.
- [x] Keep the existing `orderCache` behaviour on a failed server read, which is
      the offline fallback and is unrelated to this defect.

## 3. Refuse an already-taken action on the tablet

- [x] Have `payOrder` project the order through the task 1 function instead of
      trusting `readOrder`'s unoverlaid server row.
- [x] Refuse when the projection reads `paid` or `cancelled`, with a message
      naming which, through the existing `BillingActionError` vocabulary.
- [x] Confirm the refusal never fires after an accepted `void_order_payment`,
      because the projection is `open` again by then.
- [x] Do the same for `set_order_preparation`: production refused one on
      2026-08-26 at 20:05 IST because order 24 had been marked prepared five
      seconds earlier and was already paid. Same torn read, the preparation fact
      rather than the payment fact, so the guard must cover it too.

## 4. Offer correction only where a retry could succeed

- [x] Classify refusals into correctable and terminal, in one place both the
      tablet's attention surface and any future reader can use. Terminal:
      `order_not_open`, `payment_edit_expired`, `removed_tablet`,
      `malformed_payload`, `arithmetic_invalid`, `unsupported_schema`,
      `unresolved_operations`, `authorization_refused`.
- [x] Withhold the correct action for terminal refusals on the tablet, keeping
      discard, the refused trace and the tombstone exactly as they are.
- [x] Have `correctAttention` refuse a terminal refusal at the store boundary
      too, so the rule does not live only in a button's disabled state.
- [x] Reword the manager panel's advice so it names discard for terminal
      refusals instead of recommending an action that cannot work.

## 5. Name the order in the refusal

- [x] Add `orderNumber` and `orderId` to the refusal results of the command
      functions that already hold the order row, in a `create or replace`
      migration that changes no guard's verdict.
- [x] Widen `RefusedBillingCommandResult` with the two optional fields and
      confirm `parseBillingCommandResult` still accepts every existing shape.
- [x] Render the order on the tablet's attention item and in the manager's
      Status panel, so a refusal reads as the order it was about.

## 6. Pin it

- [x] A race test in `src/data-access/supabase-adapters/billing.test.ts` that
      lands the accept between the two reads and asserts the paid order does not
      return to `unpaidPrepared`. **Prove it fails on the tree before the fix.**
- [x] A test that un-pay-then-repay still completes, so the guard cannot be
      written history-keyed without going red.
- [x] A test that a second payment for an order the tablet already holds as paid
      is refused locally, before any command is minted.
- [x] A test that a command created during an in-flight read appears on the next
      read, pinning D2's accepted mirror gap as bounded rather than permanent.
- [x] A test that a terminal refusal offers no correction and that
      `correctAttention` rejects one, so the two presses that happened on
      2026-08-26 cannot happen again.
- [x] A test that a correctable refusal still corrects, so the split does not
      quietly disable the feature.
- [x] A database test that a refused command reports its order number, and that
      every guard still refuses and accepts exactly what it did before.

## 7. Gate

- [x] `npm run typecheck`, `npm run lint`, `npm run format:check`.
- [x] The touched vitest files, then the full unit suite.
- [x] `npm run test:db` and `npm run test:rls`, which this change now needs
      outright: it carries a migration.
- [x] The full local gate set including the Docker-backed database jobs, read
      off the CI workflow rather than a checklist, because this change is on the
      offline and outbox path.
- [x] Commit locally. **Do not push**: the counter is trading and a push is the
      release. Hand the deploy window to the owner.
