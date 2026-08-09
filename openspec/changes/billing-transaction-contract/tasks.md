> **Verification protocol for this change.** Every database rule below is written
> as a failing test **before** the function, trigger or policy that satisfies it,
> and each numbered section ends in its own provable gate. This is what replaces
> the model originally assigned to this change; see the Model column note in
> `ROADMAP.md`.

## 1. Preflight and schema

- [ ] 1.1 Inspect production and seed counts for bills, bill items and customers, and abort the migration with non-identifying diagnostics if unexpected real money history exists.
- [ ] 1.2 Write the failing DB tests first for every invariant in sections 1 and 2, so the migration is written against assertions rather than the other way round.
- [ ] 1.3 Add outlet-scoped `orders` and `order_items` with UUID keys, owning tablet, creator and shift, explicit business date, integer-paise totals, captured line snapshots, customer form snapshot, and attribution columns for change, cancellation and payment.
- [ ] 1.4 Add the daily order-number sequence, allocated per outlet per resolved business date in the same transaction as the order insert, restarting each business day.
- [ ] 1.5 Add `billing_commands` receipts and end-of-day confirmations with their watermarks.
- [ ] 1.6 Extend `bills` with the order and payment clocks, payment business date, and the optional link to its source order, without weakening the immutable paid-history constraints.
- [ ] 1.7 Add constraints and triggers for order state transitions, aggregate line arithmetic, captured snapshots, and immutable paid and cancelled states.
- [ ] 1.8 Preserve the transactional per-outlet bill-number allocator so only a successful payment consumes a permanent number.
- [ ] 1.9 Regenerate schema types and update typed seeds and fixtures.
- [ ] 1.10 GATE: order creation, daily numbering across a cutover, and the two-number separation are provable from `npm run test:db`.

## 2. Atomic billing commands

- [ ] 2.1 Implement canonical envelope hashing, schema-version validation, UUID claiming, exact replay responses, and identity conflicts on changed payloads.
- [ ] 2.2 Implement atomic create, revise and cancel order commands with owning-tablet enforcement, status-at-lock checks, and actor attribution.
- [ ] 2.3 Implement atomic pay-now and pay-order commands that validate every line and total, allocate one bill number, persist final snapshots, and commit the receipt and the result together.
- [ ] 2.4 Implement attributed bill void, preventing in-place mutation of settled facts.
- [ ] 2.5 Implement manager cancellation of any open order at an outlet they are entitled to, with a reason, requiring no shift and no tablet state.
- [ ] 2.6 Enforce historical shift bounds, pre-removal creation time, and future-clock tolerance for delayed commands.
- [ ] 2.7 Revoke direct client insert, update and delete on orders, order items, bills and bill items, so every money mutation uses the command surface.
- [ ] 2.8 Implement the end-of-day confirmation command, watermark invalidation, and the locked readiness check over open orders, live shifts and every participating tablet.
- [ ] 2.9 Make every command default all optional arguments and add the test that fails if any client payload omits a declared key. **Inherited from `undefined-command-arguments-vanish-on-the-wire`**, which is this exact failure reaching production in attendance on 2026-08-04.
- [ ] 2.10 GATE: pay-now and pay-order produce byte-identical bill shapes, an exact retry lands the money once, and a changed-payload replay is refused.

## 3. Tenancy, authority and concurrency tests

- [ ] 3.1 Add RLS policies for every new outlet-scoped table and prove a Biller or FA session cannot read or mutate another outlet, while SA cross-outlet access stays limited to designed surfaces.
- [ ] 3.2 Add database tests for operator eligibility, owning-tablet enforcement, manager cancellation scope, and ordinary Employee denial.
- [ ] 3.3 Add concurrency tests proving exact retries return one result, changed UUID payloads fail, a pay racing a cancel refuses cleanly with no bill and no consumed number, and successful payments allocate one non-reused bill number.
- [ ] 3.4 Add tests for atomic parent and line failure, integer-paise aggregate arithmetic, historical snapshots, and direct-write denial.
- [ ] 3.5 Add date tests proving revenue stays on the order business date while cash uses the payment business date across a cutover.
- [ ] 3.6 Add tests proving open orders, live shifts, and missing or stale end-of-day confirmations block settlement readiness even through hand-crafted requests.

## 4. Typed command contract and documentation

**The local operation store is #10's, not this change's.** It arrived here from #9
on 2026-08-09 because the queue's envelope, canonical hash and idempotency key are
this change's design, and #9 would have invented a payload shape. That reasoning is
about a **shape**, and the shape stays here in 4.1. The **store** moved on to #10 on
2026-08-09, where the adapters that fill it and the screens that drive it also live,
and where dependency-ordered draining is already specified. Building it here would
mean a queue with nothing to put in it, no promoted gate to run it, and no ordering
rule for the create-revise-pay chains this change introduces.

- [ ] 4.1 Add typed adapter and domain command and result shapes for the order lifecycle, payment, void, refusal categories and delayed acceptance, without promoting any feature gate. **This includes the immutable command envelope and the canonical hash**, which lives in `shared/` beside `phone.ts` so the client and the database compute the same hash from the same payload, and idempotency cannot fail on a formatting difference.
- [ ] 4.2 Update `docs/DATA_MODEL.md`, `docs/ARCHITECTURE.md` and `docs/BUSINESS_CONTEXT.md` with orders, the two numbers, atomic payment conversion, both clocks and immutable bills.
- [ ] 4.3 Update `docs/GLOSSARY.md` with order, bill, order number, bill number, shift and end-of-day confirmation, each defined once.
- [ ] 4.4 Update `docs/OFFLINE_AND_SYNC.md`, `docs/SECURITY_AND_PRIVACY.md` and `docs/LIMITATIONS.md` with command receipts, historical shifts, and the launch exclusions, including that there is no order transfer and no recovery path, and that the durable queue arrives with #10.

## 5. Verification and phase gate

- [ ] 5.1 Run `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run contrast`, `npm run build` and `npm run test:e2e`.
- [ ] 5.2 Run `npm run db:start && npm run db:reset`, then `npm run test:db`, `npm run test:rls` and `npm run test:e2e:auth`.
- [ ] 5.3 Run `npm run db:types` and confirm `git diff --exit-code src/data-access/database.types.ts` is clean once the regenerated file is staged.
- [ ] 5.4 Adversarial review pass: a separate session reads these spec deltas against the delivered migration, functions and policies, and reports every requirement it cannot find enforced at the database. Findings are fixed before archive.
- [ ] 5.5 PHASE GATE: demonstrate an order taken, prepared and paid, and a sale paid outright, producing the same immutable bill; a daily order number that restarts and never resembles a bill number; an exact retry that lands once; a changed-payload reuse refused; a pay racing a manager's cancellation refused with no number consumed; revenue and drawer dates separated across a cutover; and database-enforced sign-off blockers, all before `ui-billing-lifecycle` begins.
