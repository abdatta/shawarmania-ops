# Tasks: a-customer-is-a-phone-number

> **Sequencing.** #55 `the-ticket-is-two-switches` must be archived before
> section 4 touches the pipeline card and the activity rail: both changes edit
> the same cards, and #55 is reshaping their controls. Sections 1 to 3 are the
> composer and the dialog and do not collide with it.

> **UI first, and the owner is a hard stop.** The owner has asked to walk this in
> demo and iterate before anything is committed underneath it — this repo's
> stated delivery model applied inside one change rather than across a `ui-*` /
> `*-live` pair. **Section 2 is a gate, not a note.** No adapter wiring, no
> migration question, no docs and no spec reconciliation begins until the owner
> says the UI is settled.

> **There is a migration, and it repairs something older than this change.**
> `bills.customer_id` has never been set — every caller passes `null` and the
> settle function stores what it is handed — so no bill in production points at a
> customer. Section 3 makes the server resolve it from the phone the command
> already carries, which is also the whole of the offline story. See `design.md`
> → *Who writes `customer_id`, and why it is not the client*.

> **Sections 1 and 3 ship together, and that is a constraint rather than a
> preference.** `counter-billing` is `live`, so a push reaches every trading till
> at once — there is no per-outlet setting and one was rejected. Ship the dialog
> without the server-side link and the first number anybody enters writes a phone
> onto a bill with a null `customer_id`, while `saveCustomerIfComplete` creates
> the customer row beside it, unlinked: the exact orphan state section 3 exists
> to repair, manufactured on the way to repairing it. Production is clean today —
> zero phones, zero links — and a test run before section 3 lands would spoil
> that. See `proposal.md` → *The rollout, as the owner expects it*.

## 1. The Dialog And The Row, Against The Mock Only

- [x] 1.1 `CustomerDialog`: a `Modal` with a numeric readout and an eleven-key pad (`1`–`9`, `00`, `0`, backspace) gridded like `PaymentDialog`, no search control, and no system keyboard needed for the number.
- [x] 1.2 Two thresholds, both silent below them: **four digits** offers the best match among customers this outlet has served, and **ten** resolves against the whole business. Below four the resolution area renders nothing at all — not a spinner, not a hint, not a greyed card. Drive the ten-digit rule from `shared/phone`'s existing canonicalisation, adding no second phone rule. *(Revised at the checkpoint: the sketch had one threshold. See `design.md` → §A partial number, and why it is outlet-scoped.)*
- [x] 1.3 The match state: saved name in bold over the number, no row-type heading, action reads **Use**. The no-match state: one **required** name field — the only moment a directory row's name can be set, since `customer_create_or_get` never rewrites one from a till — with Enter and the keypad's Go key both saving. Action reads **Save**. A ten-digit number the Indian mobile rule still refuses reads as no match **and offers no save**, since a number that cannot be stored must not present a form that fails on submit.
- [x] 1.4 Skip reads **Skip** — not *No customer*, since there is still a customer and it is their number being declined — takes effect on one tap and confirms nothing. No reason prompt, no approval, no limit, and no label to type. **Reachable only from inside the dialog** — adding it to the composer is the failure mode this change exists to prevent, and it was proposed and withdrawn at the checkpoint for exactly that reason. The dialog also closes without deciding, so opening it is never a commitment.
- [x] 1.5 The composer's customer row in three states — nothing chosen, chosen (`Rahul · +91 98765 43210`), skipped (`Skipped`) — as **one control with nothing beside it**: the row reopens the dialog, and a decision is revised by making a different one. Leave the slot where #57's ⭐ will sit and draw nothing in it.
- [x] 1.6 Delete the two side-by-side inputs and the *"Add a customer name or phone to continue"* line from `bill-composer-footer.tsx`. Replace `hasCustomerIdentity` with the decision gate: identified **or** skipped enables Order and Mark Paid.
- [x] 1.7 Wire it to the **mock** customers adapter only, and make the demo fixtures carry a customer with a saved name, one with none, and a number that matches nobody, so all three states are walkable at `/demo` without a backend. The mock's `servedAtThisOutlet` stands in for the outlet join, enforcing one-match-or-none and the count of the others exactly as the database must.
- [x] 1.8 Both themes and a tablet viewport, one-handed: the pad is for a thumb and the dialog must not need a scroll to reach Skip or the action.
- [x] 1.9 SECTION GATE — at `/demo` as a Biller, every state walks on the mock: match, no-match-then-save, skip, reopening a skip on the pad, clear-and-rechoose, three digits showing nothing, and a partial number offering one customer with the others counted.

- [x] 1.10 **Found at the checkpoint, and older than this change: taking the last line off does not end the bill.** The panel gives way to Bills this shift at zero lines, but the customer, the bill-level discounts, the tender preset and the error banner all survived — so tapping a new item reopened the composer carrying the previous bill's state. The discounts are the sharp one and they are money: the next customer was charged a discount they never asked for, on a bill nobody would think to check. Fixed at the transition rather than with an effect, guarded so that emptying an order *being edited* is still a revision in progress. Pinned by a test proved to fail first.

## 2. 🧍 OWNER CHECKPOINT — STOP HERE

- [ ] 2.1 Hand the owner the demo and let them walk it. **Expect several rounds**; iterate on 1.1–1.8 as they ask.
- [ ] 2.2 Record what changed between the proposal's sketch and what the owner settled on, in `design.md`, so the reasoning survives into #57 — which draws the ⭐ on this row and inherits whatever shape it ends up with.
- [ ] 2.3 CHECKPOINT GATE — the owner states the UI is settled. Nothing below begins before this.

## 3. The Real Path, And The Link That Was Never Made

- [ ] 3.1 Point the dialog at the real customers adapter. It exists and is typed.
- [ ] 3.2 One lookup per distinct complete number, never one per keystroke — the per-caller bound is 120 in fifteen minutes and a per-keystroke lookup would spend it on a single customer. Keep the existing effect's canonical-phone keying.
- [ ] 3.2a **The outlet-scoped partial lookup: a new function, and the sharpest new boundary in this change.** `security definer`, taking a partial of at least four digits and returning **the one customer this outlet served most recently plus a count of the others** — never a list, and never a row from an outlet the caller does not work at. **Derive the outlet from the caller's own authority**, device enrolment or live Biller assignment, never from an argument. Write into the migration why this may be outlet-scoped when `customer_lookup_by_phone` may not be prefix-matched at all: `customers` is business-wide, so a prefix over the directory reads one franchise's customers from another's till, while a prefix over *this outlet's own bills* reads only people this counter already served. Give it its own rate bound; it is a cheaper oracle than the exact lookup but it is still one.
- [ ] 3.2b **It has nothing to answer with until 3.6 lands.** "Customers this outlet has served" is a join through `bills.customer_id`, the column no bill has ever carried. Order the work so the link is populated first, and confirm the suggestion is silent rather than wrong in the meantime.
- [ ] 3.2c **Point `suggestByPartialPhone` at that function, with the tablet's cache as the offline fallback only** — server first, cache second, never cache first. The cache is a strict subset of what the outlet has served, so falling back to it narrows the answer and can never widen it; say so in the adapter.
- [ ] 3.2d **The resume cache becomes a rolling fifty with no time limit, and is cleared when the tablet's enrolment is revoked.** `REMEMBERED_CUSTOMER_RETENTION_MS` was forgetting the weekly regular, who is the customer worth remembering; dropping it leaves fifty names and numbers on the device indefinitely, which is why revocation must now wipe them.
- [ ] 3.3 Refused, rate-limited and failed lookups read to the biller **exactly** as a number that matched nobody. The three are distinguishable in `CustomerActionError` and must not be distinguishable on screen: the difference is only useful to somebody probing the directory.
- [ ] 3.4 Write the failing test first: a settled bill whose command carried a phone has a non-null `customer_id` pointing at the customer with that phone. It fails today against every bill ever written.
- [ ] 3.5 An **internal, unbounded** resolve function — `security definer`, revoked from `public`, `anon` and `authenticated`, callable only from inside the billing functions. **Write the reasoning into the migration**: the bound on `customer_lookup_by_phone` stops enumeration of a ten-digit space, and resolving a number already written on the bill being settled discloses nothing the caller did not supply. The two functions will come to look alike and somebody will want to merge them.
- [ ] 3.6 The billing functions resolve `customer_id` from the command's `customerPhone` instead of trusting the client's always-null `customerId`. Covers every path that writes an order or a bill, including payment on handover and order revision.
- [ ] 3.7 **A customer that cannot be resolved must never fail a sale.** The command settles carrying its snapshots and a null `customer_id`. Prove it by making the resolve fail deliberately and confirming the money still lands.
- [ ] 3.8 Choosing a customer still writes **`customer_phone` and `customer_name`** onto the order and the bill snapshot — the server supplies the id, the till supplies the snapshots. Writing the id alone leaves #58 with nothing to print and breaks manager bill detail, which reads the snapshots.
- [ ] 3.9 Skipping sends no phone, so the server creates nothing and `customer_id` stays null. Assert against the database, not only in the UI. No special case should be needed — if one is, the resolve is wrong.
- [ ] 3.10 **No backfill of existing bills, and confirm that before relying on it.** Production on 2026-09-18 carried 1840 bills and 1941 orders, of which **zero** held a phone and zero held a `customer_id`, against an empty `customers` table — so there is no link to reconstruct for any historical row, even in principle. Re-run the counts at implementation time and record them; if a phone has appeared since, stop and decide deliberately, because `#32` set the precedent for a narrow rewire under a lifted `bills_append_only` and that is a decision, not a default.
- [ ] 3.11 Reconsider `saveCustomerIfComplete`. It is no longer the persistence path, only an optimistic warm-up. Keep it with a comment saying so, or drop it — but it must not be left looking like the thing that saves customers.
- [ ] 3.12 Confirm the saved profile is still never rewritten from the till, now that the server creates customers: a label differing from a matched customer's saved name snapshots onto this bill only. Prove it holds in `customer_create_or_get` and in the mock.
- [ ] 3.13 **No new client grant on `public.customers`, and no browse, prefix, fuzzy, list or count path anywhere** — including in the mock. The new function is internal and must never become a client surface.
- [ ] 3.14 Regenerate schema types and commit the diff.
- [ ] 3.15 SECTION GATE — a live tablet rings an order against a saved number, a new number and a skip; all three rows are the shapes above; the two identified ones point at exactly one customer row each; and a deliberately broken resolve still takes the money.

## 4. Offline, And The Cards The Label Reaches

- [ ] 4.1 Keep the remembered-versus-live distinction in the dialog: a match served from the tablet's last successful read says so and says it will be rechecked on sync. Do not collapse the two into one message — a stale name given confidently is worse than one given with its age.
- [ ] 4.2 An unknown number offline resolves to nothing in the dialog and the biller carries on. **The customer is created when the command drains, not by the dialog** — this is the section-3 resolve doing its job, and there should be no offline branch to write. Prove it: ring offline against a number the tablet has never seen, reconnect, and confirm exactly one customer row exists and the bill points at it.
- [ ] 4.3 Drain a large queue — several hundred commands, comfortably past 120 — and confirm none is refused. This is the rate-bound hazard the internal resolve exists to avoid, and it is the one that would cost real money.
- [ ] 4.4 Confirm the label reaches the open-order card, the pipeline card and the shift bill list unchanged, for both an identified customer and a skip. **After #55 archives** — these are the cards it is reshaping.
- [ ] 4.5 Reshape the composer footer's shimmer for the row that replaced two inputs, per the standing rule that a placeholder reserves the shape of what is arriving. If there is nothing to reshape, record why rather than skipping it silently.
- [ ] 4.6 SECTION GATE — aeroplane mode: a remembered number, an unknown number, and a skip, all settling exactly once on reconnect, each linked to exactly one customer row or to none, with no duplicate created and nothing refused.

## 5. Tests, Demo, Docs And Phase Gate

- [ ] 5.1 Component tests for the dialog covering every scenario in the delta, including the two that are about absence: nine digits showing nothing, and a rate-limited lookup being indistinguishable from a miss.
- [ ] 5.2 Extend `billing-counter.test.tsx`, replacing the case that asserts *"requires either customer name or phone"* — that behaviour is what this change removes, and leaving the test green would mean the rule was never really replaced.
- [ ] 5.3 Walk the four-role demo end to end and update `docs/DEMO_MODE.md`: its script names typing `9000000101` for autofill and `12345` for a refused number, and both move into the dialog.
- [ ] 5.4 Update `docs/SCREENS.md` — the composer's customer rules, the *"either name or phone"* paragraph and the phone-validation bullet all describe behaviour this change replaces.
- [ ] 5.5 Update `docs/LIMITATIONS.md` — the *"operating trial"* paragraph about name-or-phone, and the phone-is-the-identity consequences under *"One customer identity, and deliberately nothing built on it"*.
- [ ] 5.6 Run `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm run functions:typecheck`, `npm test`, `npm run contrast`, `npm run build` and `npm run test:e2e`, then look at the counter on a tablet viewport and a phone viewport, in light and dark.
- [ ] 5.7 Run `npm run db:start && npm run db:reset`, then `npm run test:db`, `npm run test:rls` and `npm run test:e2e:auth`, in that order. The local Supabase container is shared with other sessions — re-reset before trusting a result.
- [ ] 5.8 🧍 A real biller rings live orders with it at the counter. Tasks complete is not the archive trigger; real use is.
- [ ] 5.9 PHASE GATE — a biller identifies the customer in front of them from one tap and an on-screen keypad: a complete number resolves to the saved name, an unknown one offers to save it with a name, and neither path leaves the bill screen; the name box has stopped being an identity field and become the label the kitchen and the rail call the order by; a biller who is not given a number taps **Skip** once, still labels the order, and creates nothing in the directory; Order and Paid stay disabled until the biller has either identified or skipped, so the number is the default rather than the rule; no browse, prefix or list path over the customer directory exists anywhere, on screen or in the database; **every bill rung against a number points at exactly one customer, including every bill rung while the tablet was offline**, and no failure to resolve one has ever refused a sale; and the four-role demo walkthrough still walks.
