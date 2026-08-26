# Tasks

## 1. Name the projection

- [ ] Lift the envelope-overlay loop out of `readOrders` in
      `src/data-access/supabase-adapters/billing.ts` into one function that takes
      a server snapshot plus this outlet's local envelopes and returns what the
      tablet believes, replaying every command type it handles today.
- [ ] Leave the `state !== 'needs_attention'` exclusion exactly as it is: a
      refused command did not happen, and that is already correct.

## 2. Reverse the two reads

- [ ] Read the outbox envelopes before the server `orders` snapshot in
      `readOrders`, and compose through the function from task 1.
- [ ] Check `readBills` and `overlayDurableBills` for the same two-read shape
      and reverse them on the same reasoning if they have it, or record in the
      change why they do not.
- [ ] Keep the existing `orderCache` behaviour on a failed server read, which is
      the offline fallback and is unrelated to this defect.

## 3. Refuse an already-taken action on the tablet

- [ ] Have `payOrder` project the order through the task 1 function instead of
      trusting `readOrder`'s unoverlaid server row.
- [ ] Refuse when the projection reads `paid` or `cancelled`, with a message
      naming which, through the existing `BillingActionError` vocabulary.
- [ ] Confirm the refusal never fires after an accepted `void_order_payment`,
      because the projection is `open` again by then.
- [ ] Do the same for `set_order_preparation`: production refused one on
      2026-08-26 at 20:05 IST because order 24 had been marked prepared five
      seconds earlier and was already paid. Same torn read, the preparation fact
      rather than the payment fact, so the guard must cover it too.

## 4. Pin it

- [ ] A race test in `src/data-access/supabase-adapters/billing.test.ts` that
      lands the accept between the two reads and asserts the paid order does not
      return to `unpaidPrepared`. **Prove it fails on the tree before the fix.**
- [ ] A test that un-pay-then-repay still completes, so the guard cannot be
      written history-keyed without going red.
- [ ] A test that a second payment for an order the tablet already holds as paid
      is refused locally, before any command is minted.
- [ ] A test that a command created during an in-flight read appears on the next
      read, pinning D2's accepted mirror gap as bounded rather than permanent.

## 5. Gate

- [ ] `npm run typecheck`, `npm run lint`, `npm run format:check`.
- [ ] The touched vitest files, then the full unit suite.
- [ ] The full local gate set including the Docker-backed database jobs, read
      off the CI workflow rather than a checklist, because this change is on the
      offline and outbox path.
- [ ] Commit locally. **Do not push**: the counter is trading and a push is the
      release. Hand the deploy window to the owner.
