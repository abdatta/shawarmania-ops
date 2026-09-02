# Tasks: Public Bill Receipt

> ## ⚠️ One step is the owner's, and no agent can do it
>
> **The `shawarmania.in` nameservers must move from Hostinger to Cloudflare**, or
> there is nowhere to route `/bill/*` and the finished feature has no public URL.
> It touches the live marketing site's DNS, so it is the owner's to perform, at a
> quiet hour, and **never while the counter is trading**. The runbook and the
> rollback are in `design.md` §1; the task is 7.1.
>
> **Do not block the rest of this change on it.** Everything in both repos builds
> and verifies against a `workers.dev` URL first. The apex route is the last step.
> But say so to the owner when you start, not when you finish, because it is the
> only thing between a working build and a working link.

> **This is the parent change of a pair.** Section 5 drives the companion change
> `public-bill-receipt-page` in the sibling repo at
> `C:\Users\iamro\Code\shawarmania` to completion. **Neither half ships alone** —
> this repo produces a link with nothing to open, that one produces a page with no
> link to serve. Do not consider this change applied until section 5's gate is
> green.

> **Sequencing.** #53 `a-discount-is-a-line-on-the-bill` must be **archived**
> before section 4 renders discount lines and before section 3's `counter-billing`
> delta applies, because the receipt reproduces the discount lines, the rounding
> line and the ₹1 floor that #53 defines, and both changes edit the same
> capability. #53 itself requires #35 archived. Sections 1 and 2 depend on neither
> and may run first.

> **Test-first for the database rules in sections 1 and 2**, per the roadmap's
> protocol for anything touching money or tenancy. Every rule is written as a
> failing test before the migration or function that satisfies it.

## 1. The Link, In The Database

- [ ] 1.1 Write the failing tests first: a bill insert produces exactly one link row with a unique token; two bills never collide; a revoked link is refused; a revoked bill can be issued a fresh link; revoking never modifies the bill; and no operation on a link can modify a bill.
- [ ] 1.2 Add `bill_public_links (bill_id uuid primary key references bills(id), token text not null unique, created_at timestamptz not null default now(), revoked_at timestamptz)`. **No length check on `token`** — a longer token must be mintable later without invalidating any link already issued (`design.md` §2).
- [ ] 1.3 Add the token generator as a function over `left(translate(encode(gen_random_bytes(8), 'base64'), '+/', '-_'), 10)`. `pgcrypto` is already installed in production in the `extensions` schema; the expression was verified against production on 2026-09-03.
- [ ] 1.4 Add the after-insert trigger on `bills` that writes the link row, and prove it fires for every insert path including a command-created bill.
- [ ] 1.5 Backfill every existing bill in the same migration, and **assert the row counts match afterwards** so a partial backfill aborts the migration rather than leaving bills silently unshareable. Production held 1,035 bills on 2026-09-03; do not hard-code that number, read it.
- [ ] 1.6 Confirm `bills_void_only()` is untouched and still refuses every update except `settled → void`, with a test that asserts a link write cannot reach `bills`.
- [ ] 1.7 **Isolation cases for `bill_public_links`**: a Franchise Admin, a Biller and an Employee are each refused another outlet's link rows by a hand-crafted request, and the anonymous role is refused the table entirely.
- [ ] 1.8 Regenerate schema types and commit the diff.
- [ ] 1.9 SECTION GATE — every bill in a fresh reset has exactly one link, revocation kills one link and no other, the bill is unmodifiable through any link path, and the neighbouring outlet is refused.

## 2. The Public Reader

- [ ] 2.1 Write the failing tests first: the function returns a receipt for a valid token; returns the identical refusal for unknown, malformed, revoked and disabled; accepts no argument that widens it; and never returns customer name or phone.
- [ ] 2.2 Add one `security definer` function taking **only** a token and returning one receipt: outlet, bill number, business date and time of sale, lines with quantity and snapshotted unit price, discount records with their basis, rounding, total, payment allocations, and the void state and reason. **It must not return `customer_name` or `customer_phone`** — the omission is enforced by the function's own projection, not by the page choosing not to render them.
- [ ] 2.3 Grant execute on that function to the service role only. **Add no policy and no grant for `anon` anywhere**, and add a test asserting an anonymous session is refused bills, bill items, payments, discounts and link rows even while holding a valid token.
- [ ] 2.4 Add the kill switch as a flag the function itself honours, so disabling takes effect at the database for every caller with no deploy. Test that a disabled endpoint refuses identically rather than distinguishably.
- [ ] 2.5 Add `bill_public_link_views` recording token, time, a non-reversible client address and user agent, written by the function **only when the token resolves**. A request that resolves to nothing must cause no write — a flood of invalid tokens must not become a flood of inserts (`design.md` §5, and the anti-amplification clause in the spec).
- [ ] 2.6 **Isolation cases for `bill_public_link_views`**, same three roles, plus a case proving a view row cannot identify the customer.
- [ ] 2.7 Regenerate schema types and commit the diff.
- [ ] 2.8 SECTION GATE — one token in, one receipt out, no name, no phone, no second bill, no widening argument; four refusal cases indistinguishable; the switch works; invalid tokens write nothing.

## 3. The Seam And The Share Button

- [ ] 3.1 Add the receipt link to `BillingBill` in `src/data-access/adapters.ts`, as the URL the surface shares, resolved from the token.
- [ ] 3.2 Implement it in the Supabase adapter, and in the mock with fixture tokens that **deliberately do not resolve** — a demo that hands out a live URL over fixture data is a demo that leaks.
- [ ] 3.3 Add the Share control to the existing action row in `manager-bill-detail.tsx`, **before** `Cancel this bill`, rendered on the same `status !== 'void'` condition, so the destructive control stops being the first thing a thumb reaches.
- [ ] 3.4 Implement the three-step fallback: native share facility, else clipboard with a `Copied` confirmation, else the link as selectable text with **no** claim that it was copied. **Reuse the pattern in `src/features/accounts/account-handover.tsx`** rather than writing a second one; its comment records why the third case exists.
- [ ] 3.5 Component tests for all three device paths, for the absence of the control on a void bill, and for the button order in the row.
- [ ] 3.6 Confirm the counter tablet gains nothing: no Share control on any Biller surface.
- [ ] 3.7 SECTION GATE — an owner and a franchise admin can share a bill they can see, on a phone and on a tablet, in light and dark, and the four-role demo walkthrough still walks with a link that does not resolve.

## 4. What The Receipt Says

> The page and PDF are built in the companion repo (section 5). This section owns
> the **content contract** they implement, and is where #53's shape lands.

- [ ] 4.1 Fix the receipt's field list against the post-#53 bill: lines at snapshotted list price, each discount as its own line naming its basis (`Menu Discount (15%)` over the categories it covered, `Discount (₹50)` over `On this bill`), the rounding line, the total.
- [ ] 4.2 Assert the receipt performs **no arithmetic**: every figure is a stored integer-paise column formatted at the display edge. Add a test over a discounted bill proving the rendered figures equal the stored ones, because a receipt that computes disagreeing with a bill that stored is the worst bug available here.
- [ ] 4.3 Cover the ₹1 floor: a fully discounted bill renders the giveaway, the rounding that carried it to one rupee, and a ₹1 total, as honest figures rather than a rendering fault.
- [ ] 4.4 Cover the void case (reads `Cancelled`, unmistakably) and the corrected-tender case (reads the corrected split), both from a live read.
- [ ] 4.5 Confirm no tax line, no GSTIN, and nothing resembling a tax invoice while every bill is `no_tax`.

## 5. The Companion Change, In The Landing Repo

> **Repo**: `C:\Users\iamro\Code\shawarmania` (`abdatta/shawarmania`), a sibling
> checkout of this one. It runs the same OpenSpec workflow. Work on a branch, not
> on `main`.

- [ ] 5.1 In that repo, run `/opsx:apply public-bill-receipt-page` and work its `tasks.md` to completion. It owns the Cloudflare Worker, the themed page, the PDF, the caching, the headers and the abuse controls.
- [ ] 5.2 Give it what only this repo knows: the receipt function's name and signature, the shape it returns, and the service-role credential handling. The credential is a Worker secret and **never** enters that repo's source or its bundle.
- [ ] 5.3 Verify end to end against a real bill from a local reset: page renders, PDF downloads from its own URL, void reads cancelled, revoked refuses, invalid refuses identically.
- [ ] 5.4 SECTION GATE — the companion change's own final gate is green, and a link copied from this app's Share button opens a correct receipt.

## 6. Docs, Board And Backlog

- [ ] 6.1 `docs/ARCHITECTURE.md` — a third deployable and the first server-side runtime; why the apex is fronted by Cloudflare; why the PDF is built outside Supabase.
- [ ] 6.2 `docs/DATA_MODEL.md` — `bill_public_links` and `bill_public_link_views`, and the invariant that a bill's link is not its identity.
- [ ] 6.3 `docs/SECURITY_AND_PRIVACY.md` — the first unauthenticated public endpoint; that it names no customer and why; the access record; revocation and the kill switch.
- [ ] 6.4 `docs/OPERATIONS.md` — the DNS move and its rollback, the Worker's secrets and deploy, revoking one link, and the kill switch.
- [ ] 6.5 `docs/SCREENS.md` — the Share control, and the receipt page as the one surface a customer ever sees.
- [ ] 6.6 `docs/LIMITATIONS.md` — links are shared by hand until delivery is built; a link cannot be recalled from someone who already opened it, only revoked.
- [ ] 6.7 Delete `openspec/todos/bill-digital-share.md`, promoted by this change, and **seed a new todo for delivery** carrying what it did not answer: WhatsApp Business API against SMS/DLT, opt-in per bill against automatic, consent recording, and the mistyped-number problem.
- [ ] 6.8 Add the #54 row to `openspec/changes/ROADMAP.md` and run `npm run roadmap:sync`. Never hand-stamp a status.

## 7. The Owner's Step

- [ ] 7.1 **The DNS move, which only the owner can perform.** Create the `shawarmania.in` zone in Cloudflare, let it import the existing records and **verify them against `design.md` §1 before changing nameservers**, set SSL to Full, then switch nameservers at Hostinger. GitHub Pages keeps serving the site; Cloudflare only adds a Worker route on `/bill/*`. Rollback is switching the nameservers back.
- [ ] 7.2 Everything else is testable against a `workers.dev` URL first. **Do not block the rest of the change on this**, and do not schedule it while the counter is trading.

## 8. Phase Gate

- [ ] 8.1 **PHASE GATE — the Wave E checkpoint for #54.** A customer opens a link on a phone and sees their own bill on `shawarmania.in`, themed and readable, with items at list price, every discount as the line it was given as, the round-up and the tender split; downloads it as a PDF from its own URL; and finds no name and no phone number anywhere. Every bill ever rung is linkable and stays linkable until revoked, which kills one link and no other. Wrong, revoked and invented links are refused in identical words, and an invalid token writes nothing. The owner and a franchise admin share from a bill they can already see and never another outlet's. Nothing is stored, nothing is indexed, no `anon` grant was added, `bills` is untouched, the counter cannot tell this change happened, and the four-role demo walkthrough still walks while sharing a link that does not resolve.
