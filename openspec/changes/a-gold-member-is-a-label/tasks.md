# Tasks: a-gold-member-is-a-label

> **Sequencing.** #56 `a-customer-is-a-phone-number` built the composer's
> customer control and the dialog this change draws the member mark on, and left
> the mark's slot deliberately empty. It was archived on 2026-09-22 and is live.

> **UI first, and the owner is a hard stop.** Same instruction and same reason as
> #56. **Section 2 is a gate, not a note.** No migration, no function, no policy
> and no spec reconciliation begins until the owner says the UI is settled.

> **This change depends on `#56` having made the customer link real.**
> `bills.customer_id` was null on every bill ever written until `#56` made the
> server resolve it from the phone on the command. The thirty-day figures join on
> that column, so without it this card reads `0 visits, ₹0` for everybody. Check
> it holds before building section 3.7. **There is no history behind it**:
> `#56` backfilled nothing (one historical bill carried a phone, and lifting
> `bills_append_only` for it was out of proportion), so the figures begin at its
> release on 2026-09-22. Every card and the regulars list read thin until the new
> flow has been running a month — expected, not a defect, but say so before the
> demo rather than during it.

> **Two boundaries, never one.** `#32` deliberately wrote the owner's directory
> read and the till's lookup as separate functions with separate authority
> checks, so that widening one can never widen the other. This change adds an
> owner write path and widens the till's response by one field. **Do not
> consolidate them**, however much the bodies come to resemble each other.

## 1. The Owner's Card And The Counter's Mark, Against The Mock Only

- [x] 1.1 Extend the mock customers adapter with membership: grant, revoke, the derived current state, and the thirty-day figures. It must enforce the real boundary the way `mock/customers.ts` already does — only the owner grants, only a billing context reads the mark, and neither can reach the other's path. The owner's methods live on **their own adapter**, so the two-boundary rule is visible in the types as well as the SQL.
- [x] 1.2 The owner's customer surface: **search by name or by part of the number, from three of either** [owner, 2026-09-24] — letters anywhere in the name, digits anywhere in the number, at most twenty results and a count of the rest — plus **two lists requiring no search, as tabs with Regulars first** [owner, 2026-09-24] — *Regulars* (everybody seen in the last thirty days, most visits first, one visit included, each with its count) and *Gold* (everyone holding a membership now) — each loading twenty at a time as the reader scrolls; no count on either tab, since each is the whole of its kind. Registered in `src/gates/registry.ts` as a Super Admin surface, **Setup group, labelled `Customers`, ordered after People**, gated `demo` until section 3 makes it real.
- [x] 1.3 The customer card as a **modal, never a route** — no address identifies a customer. Identity block, then the derived block, in the shape recorded in `design.md`.
- [x] 1.4 Rename in place: the pencil turns the name into an input and itself into a tick. Icon-only, no button at the foot of the card. **A name can be corrected, never erased** — the tick is unavailable while the input is blank.
- [x] 1.5 Membership as a status row with one icon-only control beside it — a star to grant, a crossed star to revoke, because **the icon carries the verb and the text carries the state**. `Gold member since <date>` or `Not a gold member`.
- [x] 1.6 Confirmation on both directions through the existing `ConfirmDialog`, identically. It opens over the card; `Modal` already handles the stacking and its `onClose` already stops propagation, so this is reuse rather than new ground.
- [x] 1.7 The member mark at the counter: on #56's composer control, on the resolved match **inside** the dialog before it is accepted, **on the partial-number suggestion**, on the open-order card, on the pipeline card and on the shift bill list — and on the owner's and manager's Billing history detail, read from the same snapshot. No date, no actor, no history, no figure, anywhere.
- [x] 1.8 Demo fixtures: a member, a non-member, a member with a revoked-then-regranted history, and a customer whose bills are all older than thirty days — so the empty-window state is walkable rather than theoretical.
- [x] 1.9 Both themes; the owner's surface at phone width, the counter's mark at tablet width.
- [x] 1.10 SECTION GATE — at `/demo`: the owner searches, opens the card from a search and from each list, grants, confirms, reopens, revokes, re-grants and renames; a biller identifies that customer and sees the mark on every counter surface, and the owner sees it in Billing history.
- [x] 1.11 The Franchise Admin's view [owner, 2026-09-24]: the same surface and card over the outlets their assignments name — only customers those outlets served, figures from those outlets' bills alone, *First visit here* in place of *Customer since* — registered as `admin-customers` beside the owner's entry. Name and gold changeable **only for a customer served at no other outlet**, decided by the adapter from the customer's whole history and again at the moment of the write; a read-only card says why in one sentence.

## 2. 🧍 OWNER CHECKPOINT — STOP HERE

- [x] 2.1 Hand the owner the demo and let them walk it. Expect several rounds; iterate on 1.2–1.9 as they ask.
- [x] 2.2 Record what changed between `design.md`'s sketch and what the owner settled on, including anything about the mark's placement that #56's final shape forced.
- [x] 2.3 CHECKPOINT GATE — the owner states the UI is settled. Nothing below begins before this. **Settled 2026-09-24.**

## 3. Membership In The Database

- [ ] 3.1 Write the failing tests first: a grant then a revoke leaves both rows readable; a re-grant reports the newest grant as the start; the derived current state matches the records in every ordering.
- [ ] 3.2 The membership table — `customer_id`, `granted_at`, `granted_by`, `revoked_at`, `revoked_by`, and a reason column left unused by this change. **Global, like `customers`, and therefore treated like it**: revoked from `authenticated` and `anon`, RLS enabled with no policy, reachable only through security-definer functions. Two independent statements of one rule, as `01_schema_coverage.sql` requires of a table it cannot classify as outlet-scoped.
- [ ] 3.3 A revocation is **its own row, never a deletion**. An automatic rule will later need to know a human took a membership away so it does not hand it straight back; deleting the grant would destroy the only fact that could stop it.
- [ ] 3.4 The owner's grant and revoke functions, checking owner authority — **separate from the till's path**, per `#32`'s two-boundary rule.
- [ ] 3.5 The owner's rename function. It changes the saved profile only; prove a bill and an order snapshotted before it still report what they snapshotted. **No delete and no merge path** is added here.
- [ ] 3.6 The owner's search and the two bounded lists. `customer_directory()` returns the entire directory ordered by `created_at`, unpaginated — written when the table had zero rows — so it is replaced by: a search taking a name fragment (three or more characters, case-insensitive `ilike` with `%` and `_` in the input escaped, then — only while fewer than twenty match — the same characters in order with gaps, ranked below every exact match, exactly as `src/domain/customer-search.ts` does) or three or more digits matched as one run anywhere in the ten-digit number, returning at most twenty rows most-recently-seen first plus a count of the rest; and the two lists **paged twenty at a time, in a total order** — the current members (newest grant, then id) and everybody seen in the last thirty days (visits, then most recent visit, then id) — all derived at read time. Keyset paging is the better fit in SQL if offsets ever prove slow; the adapter's `next` hides which. Consider a trigram index on `customers.name` only if the directory grows past what a sequential scan answers quickly.
- [ ] 3.7 The thirty-day figures, derived at read time from bills under the reader's own authority, **joined on `bills.customer_id`** — which `#56` made real and which was null on every bill before it. **One bill is one visit**, voided bills excluded from both the count and the amount, and the window measured against the business date. **No aggregate column is added to `customers`** — `#32` removed `bill_count` and `total_spend_paise` for this exact reason and they must not return under a new name.
- [ ] 3.8 An index on `bills.customer_id`. There is none — nothing has ever queried bills by customer — and the thirty-day figures need it across outlets.
- [ ] 3.6a The manager's scope, **written once**: one helper answering "which outlets may this caller read customers through" — every outlet for `app_is_owner()`, `app_outlets_for('franchise_admin')` otherwise, nothing for anybody else — and every management read (search, both lists, the card's figures, last seen, first visit) built on it. A customer none of the caller's outlets has served returns nothing, indistinguishable from one who does not exist.
- [ ] 3.6b The manager's write condition: grant, revoke and rename check, **inside the writing transaction**, that every order and bill the customer has anywhere belongs to one of the caller's outlets. Returned on the card as `editable`, but never trusted from it.
- [ ] 3.9 Refusal cases for every path added here, **by hand-crafted request carrying a valid session**, not by an absent button: a Biller, an Employee and a counter device each refused every management read and write; an FA refused a read of a customer only another outlet served, and refused grant, revoke and rename of a customer another outlet also served — including one who became shared after the FA's card was read.
- [ ] 3.10 Regenerate schema types and commit the diff.
- [ ] 3.11 SECTION GATE — grants, revocations, re-grants and renames round-trip at the database; the figures agree with the bills they derive from; every counter principal is refused every management path; and an FA reaches exactly the customers their outlets served and changes exactly those served nowhere else.

## 4. The Snapshot, And The Widened Lookup

- [ ] 4.1 `customer_tier` on `orders` and `bills`, written at creation from the membership as it then stood, in the spirit of `unit_price_paise` on a line. Existing rows carry no membership; do not invent one for them.
- [ ] 4.2 Every surface showing the mark against an order or a bill reads **that snapshot**, never the live membership. Prove it: revoke a membership mid-shift and confirm the order rung before it still reads as a member's.
- [ ] 4.2a Resolve the membership server-side for a sale that arrives **still an open order** and carries none — the offline case where the tablet had never seen the customer. The mark then appears on its pipeline card, which is the point: the food has not gone out and the kitchen can still act on it.
- [ ] 4.2b **A sale that arrives already paid is recorded without membership, permanently.** Bills are append-only and a bill states what the counter knew and did. Prove both halves: an offline open order gains the mark, an offline paid bill never does. Getting this backwards would badge a receipt (#58) for an order served as an ordinary one.
- [ ] 4.3 Widen `customer_lookup_by_phone` **and `customer_suggest_at_outlet`** by exactly one field — current membership as a plain yes or no — and have `customer_create_or_get` return it too. **No date, no actor, no history, no spend, no visit, no outlet.** Nothing else about either boundary moves: not the exactness of the one, not the outlet scope and one-match rule of the other, not the absence of a browse path, not the rate bound, not the attempt table's rule against recording what was asked.
- [ ] 4.4 Carry the tier through the billing command payload and the outbox so an order rung offline settles carrying the mark it was rung under. Check whether this needs a `BILLING_COMMAND_SCHEMA_VERSION` bump and a both-shapes-accepted boundary, as `#53` did — and if it does, prove a command queued under the earlier shape still settles exactly once.
- [ ] 4.5 Carry the tier on the resume record's remembered customers, so a cold-started tablet can mark a customer it saw before the network went away.
- [ ] 4.6 Extend the isolation suite: a neighbouring outlet cannot read a member's order or bill through the new snapshot columns.
- [ ] 4.7 SECTION GATE — a member's order rung offline reaches the pipeline marked, settles exactly once on reconnect, and still reads as a member's after the membership is revoked; and an offline sale for a member the tablet had never seen gains the mark if it arrives open and never gains it if it arrives paid.

## 5. Demo, Docs And Phase Gate

- [ ] 5.1 Walk the four-role demo end to end and update `docs/DEMO_MODE.md` with the owner's customer surface and the counter's mark.
- [ ] 5.2 Update `docs/DATA_MODEL.md` — the membership table, the snapshot columns, and why no activity aggregate lives on `customers`.
- [ ] 5.3 Update `docs/ROLES_AND_PERMISSIONS.md` — who grants, who sees the mark, who sees the figures, and the two-boundary rule that keeps those separate.
- [ ] 5.4 Update `docs/SECURITY_AND_PRIVACY.md` — the widened lookup response **with its cost stated**: a biller at one outlet may infer membership about a customer who has only ever shopped at another. A widening recorded without its cost is how the next one gets easier.
- [ ] 5.5 Update `docs/SCREENS.md` (the owner's customer surface, the counter's mark) and `docs/LIMITATIONS.md` — *"No screen edits a customer"* is no longer true, and a customer this tablet has never seen cannot be marked offline.
- [ ] 5.6 Narrow `openspec/todos/customer-loyalty-and-cross-outlet-insights.md` to what this change leaves behind, and confirm `lint:todos` still passes.
- [ ] 5.7 Add the `customer-membership` entry to the capability index in `openspec/specs/README.md` **at the archive step, not now** — `lint:specs` checks the index against the directories under `openspec/specs/`, and that directory does not exist until the delta is merged.
- [ ] 5.8 Run `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm run functions:typecheck`, `npm test`, `npm run contrast`, `npm run build` and `npm run test:e2e`, then look at the owner's surface on a phone viewport and the counter on a tablet viewport, in light and dark.
- [ ] 5.9 Run `npm run db:start && npm run db:reset`, then `npm run test:db`, `npm run test:rls` and `npm run test:e2e:auth`, in that order. The local Supabase container is shared with other sessions — re-reset before trusting a result.
- [ ] 5.10 🧍 The owner grants a real membership to a real regular, and a biller sees the mark at the counter. Tasks complete is not the archive trigger; real use is.
- [ ] 5.11 PHASE GATE — the owner finds a customer by their complete phone number from their own phone, opens a card over the search results, and makes them a gold member or takes it back behind one confirmation; the same card corrects a misspelt name without touching a single historical bill; and it reports what that customer has done in the last thirty days without one stored aggregate, one bill counting as one visit and voided bills counting as nothing; a biller sees the mark beside the customer they have just identified and on every card that order becomes, so the kitchen can treat it differently, and sees no date, no actor, no history and no spend; an order rung offline for a member reaches the pipeline marked and settles exactly once, and an offline sale for a member the tablet had never seen is marked if it arrives still an order and never if it arrives paid; membership is business-wide and is a label only, changing no total anywhere; every non-owner principal is refused every owner path by hand-crafted request; and the four-role demo walkthrough still walks.
