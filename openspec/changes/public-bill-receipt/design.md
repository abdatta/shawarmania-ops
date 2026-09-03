# Design: Public Bill Receipt

This change was settled in conversation with the owner on 2026-09-03. Most of the
decisions below were reached by rejecting a cheaper option, and the rejections are
the valuable part: several of them look obviously right until you check something.
Everything here is written for the session that implements it, which will not have
been in that conversation.

---

## 1. Where the receipt is served, and why not from Supabase

### The chosen shape

```
customer's phone ──► shawarmania.in/bill/<token>          (Cloudflare Worker)
                          │
                          ├─ cache hit  ──► themed HTML, or the PDF
                          │
                          └─ cache miss ──► one RPC to Supabase ──► ~2 KB of JSON
                                              │
                                              └─ Worker renders HTML / builds PDF
```

Supabase ships a few kilobytes of JSON and nothing else, ever. Cloudflare ships
every byte the customer actually downloads, and Cloudflare's bandwidth is
unmetered.

### Measured, not assumed

Production on 2026-09-03: **1,035 bills since 2026-08-12**, 22 days, both outlets,
2 voided. Kalyani 550 over 17 trading days, Kanchrapara 485 over 20. A stable 40
to 60 bills a day, busiest single day 96. About **1,400 bills a month**.

| | Supabase egress per month |
|---|---|
| This design (~2 KB of JSON per bill, before any cache hits) | **~3 MB** |
| Serving PDFs from Supabase (~200 KB × ~3 views × 1,400) | **~840 MB**, growing forever |

Storing the PDFs would have added storage rent on top, for documents opened once.

### Rejected: store the PDF in Supabase Storage

Pays rent forever on a file opened once, bills egress on every download, **and
goes stale**. A stored PDF cannot know its bill was voided an hour later, or that
its tender split was corrected. Dynamic generation is not only cheaper, it is the
only shape that can be correct.

### Rejected: generate the PDF in a Supabase Edge Function

Solves staleness, not cost. A function returning a 120 KB PDF still pushes 120 KB
of Supabase egress plus an invocation. The saving comes from rendering outside
Supabase, not from declining to store.

### Rejected: static page on GitHub Pages, PDF built in the customer's browser

Genuinely tempting: zero new infrastructure, zero server cost, and the landing
site is already there. Rejected on **delivery reliability**. These links will be
opened inside WhatsApp's in-app browser on Android, where downloads driven from a
`blob:` URL are historically unreliable and fail silently. Making the flaky path
the only path breaks the feature for most of the customers it exists for. It also
leaves no place to put a rate limit, a response header, or a `Content-Type`.

### Rejected: `bill.shawarmania.in` on Vercel

Works, and needs no nameserver migration — one `CNAME` at Hostinger. Kept as the
**fallback if the DNS move is refused or goes wrong**. Not chosen because the apex
path is the better URL and Cloudflare in front of the whole brand site is worth
having anyway.

### Rejected: moving the landing site itself to Vercel

Would make `/bill/*` a function with no DNS migration at all, but it relocates a
working, deployed marketing site to serve a feature it has nothing to do with.
Disproportionate.

### The DNS move, which only the owner can do

`shawarmania.in` currently resolves at **Hostinger**: apex `A` records to the four
GitHub Pages IPs (185.199.108–111.153), matching `AAAA`, `www` as a `CNAME` to
`abdatta.github.io`, and `public/CNAME` in the landing repo carrying the domain
into the deployed artifact.

The move: create the zone in Cloudflare, **let it import the existing records and
verify them against the list above before changing the nameservers**, set SSL mode
to Full, then switch nameservers at Hostinger. GitHub Pages keeps serving
everything; Cloudflare only adds a Worker route on `/bill/*`. Do it at a quiet hour
— the counter trades from late morning, and per the standing rule the owner picks
the window.

**Rollback** is switching the nameservers back to Hostinger, whose records are
unchanged throughout. The landing site never moves and `public/CNAME` never
changes.

---

## 2. The token

### Chosen: a stored random token in its own table

```sql
-- 10 URL-safe characters, 60 bits, generated in the database
left(translate(encode(gen_random_bytes(8), 'base64'), '+/', '-_'), 10)
```

`pgcrypto` is already installed in production, in the `extensions` schema, and the
expression above was executed against production to confirm it. Truncating base64
is sound here: every character carries six independent bits of the underlying
random bytes, so ten characters are sixty uniform bits.

**Populated by an after-insert trigger on `bills`, and backfilled for every
existing bill in the same migration.** This is what makes "every bill is linkable,
with no share step" true without a single line of application code, and it is why
the mint-on-share design was dropped: the plumbing the owner objected to was the
minting, never the column.

**Offline semantics.** The trigger fires when the row reaches Postgres, which is
when the outbox drains. A bill still sitting in a tablet's queue has no link yet,
which is correct: nobody can hand out a link to a bill the server has not
accepted. The counter is not involved in generating the token, does not wait for
it, and never sees it.

### Rejected: use `bills.id` as the public key

The owner proposed this and the reasoning was half right, so be precise about
which half. `bills.id` is `crypto.randomUUID()`, a CSPRNG, 122 bits. **It is
genuinely unguessable, and enumeration was never the objection.** Three things
were:

1. **No revocation.** `bills` is append-only. A link that leaks into a group chat
   or a screenshot could never be killed by any means.
2. **It makes a primary key sometimes-secret.** `bills.id` is safe today in a log
   line, an export, a support message, a future ops URL. Make it the credential
   and every one of those becomes a disclosure, forever, prevented only by
   somebody remembering. This repo puts invariants in the database precisely so
   nobody has to remember them, and a column named `public_token` documents
   itself.
3. Every bill in the table becomes reachable the instant the endpoint ships,
   which was later chosen deliberately anyway, but should be a decision rather
   than a side effect of a key choice.

### Rejected: a hash of the bill's contents

Proposed as a way to avoid storing anything. It fails on function before it fails
on security: **a bill's contents change.** A void writes `voided_at` and a
`void_reason`; a tender correction rewrites the payment split. So the hash changes,
so the URL changes, and **the link already in the customer's phone stops working**
— on precisely the bill they most want to re-read. Content addressing suits
immutable blobs, and a bill is not one.

Hashing only the immutable subset is equivalent to hashing the bill id, which is
the next option. And an *unsalted* content hash is not a secret at all in a useful
sense: the menu is published on the same domain, entropy is lowest for the
commonest orders (a single item and a drink), anyone holding one real receipt
knows the exact serialisation, and getting the input wrong by one field collapses
the space to something walkable. The fatal property is that **the security level
becomes an accident of what somebody ordered**, and no honest number can be
written in a spec.

### Rejected: `HMAC(worker_secret, bill_id)`, stateless

The cryptographically sound version of the same instinct, and a legitimate design:
no column, no migration, stable under voids and corrections, computable for every
bill with zero backfill. Rejected because it loses per-bill revocation — rotating
the secret kills every customer's link at once — and revocation is the only off
switch left once expiry was dropped. Saving one nullable column is not worth
that.

### Rejected: `shawarmania.in/bill/<id>?token=<token>`

The owner's original shape: the id identifies, the token authorises, so the token
can be shorter. It is a real pattern (S3 presigned URLs are exactly this) but it
is for systems that must see *which* resource before they can check anything, and
ours does not: the lookup is `where token = $1` either way.

**The arithmetic kills it.** A UUID is 36 characters, so the split URL is ~91
characters against ~30 for a single opaque token. It buys a shorter token by making
the URL three times longer, and it has less security than the short version. Add
that a partial URL (`/bill/<id>` with the token dropped in a paste) looks like it
should work and becomes a support puzzle, and that it puts `bills.id` into
Cloudflare logs and browser histories permanently.

### Why ten characters, and why the analysis had to be redone

The security of a capability URL is not its bit length. An attacker is not
guessing one bill's token, they are guessing **any valid one**, so valid-token
density subtracts directly:

> effective bits = token bits − log₂(number of bills)

At an assumed attacker rate of 10,000 requests/second (a thousand-IP residential
proxy pool, each IP under a per-IP rate limit, purchasable for about a hundred
dollars), time to recover **one** random bill:

| Bills in the table | 10 chars base32 (50 bits) | 10 chars base64url (60 bits) |
|---|---|---|
| 18k (year one at today's rate) | ~2 days | **~200 years** |
| 150k (year five, two outlets, doubled volume) | hours | ~24 years |
| 400k (year five, six outlets) | hours | ~9 years |
| 1M (a decade of franchise success) | minutes | ~3.7 years |

Two corrections happened on the way to that table, and both matter:

- **The alphabet was the cheap lever.** base64url carries 6 bits per character
  against base32's 5. The owner proposed it and it moved ten characters from 50
  bits to 60, which is the difference between broken and comfortable.
- **The volume assumption was wrong, and it was doing the arguing.** An earlier
  draft insisted on more characters on the strength of a 10-million-bill scenario.
  Production says ~17,000 bills a year. Ten million is not a number this business
  reaches within the life of this scheme, and sizing against it was
  over-engineering.

The remaining margin is honest at 200 years today and years even at volumes this
business will not see soon. The prize at the end of that attack is one receipt
showing an order and no person.

**Guard rail, and the reason the short option is safe to take: do not constrain
the column's length.** `token text not null unique`, with **no**
`check (length(token) = 10)`. If the business ever reaches franchise scale the
trigger starts minting twelve or fourteen characters for new bills and every
existing link keeps working. That makes the decision reversible instead of a
one-way door.

### Why a side table rather than a column on `bills`

`bills_void_only()` refuses every update to `bills` except `settled → void`
touching only the void columns. That trigger is the append-only guarantee over the
money. Putting the token on `bills` would mean amending it to permit a column to
be mutated so a link could be revoked — weakening a financial invariant for a
publishing concern. So:

```
bill_public_links (bill_id pk → bills.id, token unique, created_at, revoked_at)
```

`bills` is untouched, revocation is an ordinary update on a table that was never
append-only, and the access log hangs off this table naturally.

### Why no expiry

The owner's stated mechanism was that links would die when stale data was cleared.
That mechanism does not exist:
[`data-retention-policy`](../../todos/data-retention-policy.md) records "Nothing is
deleted, ever", no policy is scheduled, and bills are financial records that will
be kept for years regardless. So no expiry means links live indefinitely.

Accepted, on the condition that revocation exists — which it does, and which is
strictly better for the leak case because it acts now rather than in a year, and
never breaks a receipt a customer legitimately kept. Expiry can be computed
statelessly from `business_date` later if it is ever wanted; nothing here forecloses
it.

---

## 3. Tenancy and the public reader

**This is the first unauthenticated reader in the system, and it must not become a
door.**

- **`anon` gains no new grant anywhere.** No RLS policy is added to `bills`,
  `bill_items`, `bill_payments`, `bill_discounts` or any other table to let an
  anonymous role read by token. Such a policy would mean `anon` holds `select` on
  bills, and one policy mistake would become a full disclosure.
- The Worker holds the **service-role key** as a Worker secret, server-side, never
  reaching a browser — the standing rule, unchanged.
- It may call **exactly one** `security definer` function, which takes a token and
  returns one receipt. That function resolves the bill from the token, refuses a
  revoked one, and returns only the fields the page renders. It accepts no outlet,
  no bill id, no date, no list operation, and exposes no aggregate.
- **The outlet boundary is not weakened because the reader never resolves an
  outlet at all.** It cannot enumerate, cannot widen, and cannot be pointed at a
  neighbouring outlet's rows, because its only input is a token that names one
  bill.
- `bill_public_links` is outlet-scoped through its bill and ships its isolation
  test cases with the migration that creates it, like every other table here.
- **The kill switch** is a flag the function itself honours, so disabling the
  public endpoint takes effect at the database for every caller at once, with no
  deploy.

---

## 4. What the page says

### It names no customer

Not a name, not a phone number, not four masked digits. Three reasons, and the
third only became clear when production was inspected:

1. A leaked, forwarded, misdelivered or (implausibly) guessed link then exposes an
   order and never a person, which is what makes every other risk small.
2. **Misdelivery is the realistic failure, not brute force.** Once links go out by
   phone, a mistyped digit at a busy counter sends a stranger someone else's
   receipt. `bill-digital-share` flagged this before delivery was even scoped. No
   token length defends against it; an anonymous page does.
3. **The names in production are placeholders.** All 1,035 bills carry a
   `customer_name` because the counter enforces a UI-only name-or-phone rule and
   billers type something to get past it. Rendering them would show a customer
   garbage. The owner expects names to become optional or disappear, and phone
   numbers to become near-compulsory once links are delivered — the exact inverse
   of the field an earlier draft planned to display.

Printing four masked digits was also declined so the option of using them as a
second factor is not spent. That factor is not being built (see
`proposal.md`), but printing them would foreclose it for nothing.

### What it does show

Outlet, bill number, date and time, each line at its snapshotted list price with
quantity, **each discount as its own line naming what it was**, the round-up line,
the total, and the tender split across methods. Enough for a customer to recognise
their own bill; the link arrived on their phone, so no identifier is needed to
reassure them.

### Discounts, and why this change waits for #53

[`a-discount-is-a-line-on-the-bill`](../a-discount-is-a-line-on-the-bill/proposal.md)
(#53) changes what a bill *is* in ways a receipt cannot ignore, and it explicitly
lists "a printed or shared bill showing the customer what they saved" as a
non-goal pointing back at `bill-digital-share`. So rendering discounts on the
customer's receipt is this change's job, and it must be built on the finished
shape rather than guessing at it:

- **Lines keep list prices.** The receipt must show the list price a line
  snapshotted, never a reduced unit price, because that is the fact stored.
- **Each discount is its own line with its own basis**, and must read as the
  counter recorded it: `Menu Discount (15%)` over the categories it covered,
  `Discount (₹50)` over `On this bill`. Several may appear.
- **A `Round up` line is stored and always shown.** The identity the receipt must
  reproduce is `total = subtotal − discount + tax + rounding`, and the receipt
  reproduces it rather than recomputing it.
- **The ₹1 floor is real.** A fully discounted meal is a ₹1 bill. The page must
  render that as the honest thing it is and not as a rendering fault.
- `tax` is zero on every bill (`pricing_mode = 'no_tax'`) and the receipt shows no
  tax line, no GSTIN and nothing resembling a tax invoice.

**Money arithmetic on this page is display only.** The receipt performs no
arithmetic of its own: every figure it prints is a stored integer-paise column,
formatted to rupees at the very edge. It must never re-derive a total, because a
receipt that computes disagreeing with a bill that stored is the worst possible
bug here.

### It is read fresh

A void or a tender correction after the link was sent must be visible. A voided
bill reads `Cancelled`, unmistakably, rather than presenting a valid-looking
receipt. This is the second reason nothing is stored as a file.

### Rejected: auto-download on open

Considered, and the button won on five counts. Most people opening a receipt link
want to **look** at it, and a fixed-width PDF on a five-inch screen is a worse
read than a responsive page. The download is the flaky part in an in-app browser,
so it must not be the only path — a failed tap should still leave a readable
receipt on screen. Re-opening a receipt is normal, and auto-download produces
`bill (1).pdf`, `bill (2).pdf` in someone's Downloads. Browsers increasingly block
downloads without a user gesture, and a tap is that gesture. And every link shared
on WhatsApp is fetched by Meta's crawler to build a preview, which with
auto-download would trigger a full PDF render per share and fill the access log
with noise that hides a real harvest.

### The PDF

> **Superseded during implementation, 2026-09-03.** Three of the four decisions
> below did not survive contact with the output, and the corrections are recorded
> here rather than left for somebody to rediscover. Everything else in this
> section held.

~~A4 rather than a thermal strip~~ — **80 mm wide, height fitted to the
content.** The owner opened a generated A4 receipt and overruled it on sight
[owner, 2026-09-03]: a two-line bill on A4 is mostly empty space and does not
read as a receipt. 80 mm is also the width every thermal roll printer takes, so
[`bill-thermal-printing`](../../todos/bill-thermal-printing.md), if it is ever
built, inherits the right shape rather than something to redo. The reasoning for
A4 — a document somebody may file or forward to an accountant — was not wrong
about the use, only about the paper.

~~**fonts are subset**~~ — **embedded whole.** Subsetting a *variable* font
through `pdf-lib` produced a structurally valid PDF in which every Latin letter
rendered as a missing-glyph box. Found by looking at the output; no test would
have said so. Whole faces cost about 130 KB, which is the right trade against a
receipt nobody can read.

**And a font problem the design did not anticipate at all.** `@fontsource`
splits its fonts by unicode range, and no single Nunito Sans file carries both
the digits and the rupee sign: `latin` has the digits, `latin-ext` has `₹`. A
browser stitches the ranges together with two `@font-face` rules and the page was
therefore always fine. A PDF must embed real fonts and choose one per glyph, so
the Worker embeds both and routes each character to a face that can draw it. The
first two attempts each rendered half the receipt as boxes.

Themed with the logo and brand faces, and named recognisably
(`Shawarmania-Kalyani-Bill-10.pdf`), never `download.pdf` — both as designed. The
brand name is stripped from the outlet's own name first, because every outlet is
called "Shawarmania Kalyani" and the obvious template doubles it.

### The page and the PDF are one design, enforced

> **Added during implementation, 2026-09-03, because the owner asked for it.**

The receipt is rendered twice and neither rendering can be produced from the
other inside a Worker. Two renderers over one design is the arrangement that
rots: somebody relabels a row on the page, the PDF keeps the old wording, and a
customer holding both sees two different receipts for one bill — or a row is
dropped from one and nobody notices for months.

So the renderers decide nothing a reader can read. `worker/src/content.ts` turns
a receipt payload into the ordered labels, subtexts and formatted amounts a
receipt *says*; the page and the PDF are then only presentation. `content.test.ts`
holds them to it over nine shapes of bill: the page must render every string the
model says, and the PDF's layout must emit **exactly** those strings in the same
order — equality rather than containment, because the PDF carries no chrome and
so has no excuse. The single permitted difference is presentational and named in
the test: the page shouts `Cancelled` with CSS, and the PDF, having no CSS to
shout with, upper-cases it.

### Printing the page

> **Added during implementation, 2026-09-03.** The owner asked why the browser's
> own print-to-PDF was not used instead of generating one.

It was a fair question with a two-part answer. It would genuinely delete the
PDF-drawing code — but it removes nothing about Cloudflare, because the Worker is
there for the **credential**, not the document: `anon` has no grant on `bills`, so
a browser cannot read a receipt however the PDF is produced. And it loses the tap
that matters, since Print is frequently absent from WhatsApp's in-app browser
menu, and where present it follows the printer's page size, stamps the browser's
own header and footer with the URL on them, and names the file after the page
title.

The generated PDF stays, and the page now also carries
`@page { size: 80mm auto; margin: 0 }` and a print stylesheet that inverts the
near-black canvas — so somebody reaching for Print gets the same 80 mm receipt
rather than an A4 sheet, and a printer is not emptied over the brand's canvas.

**Served from its own URL** (`…/bill/<token>.pdf`) as an ordinary link, so the
browser's own download machinery handles it. Not a script-generated `blob:` — that
is the exact failure mode that ruled out static hosting, and it must not be
reintroduced at the last step.

The **HTML page stays light** regardless: it is what a customer looks at, fonts
load with `font-display: swap` so text paints immediately on a slow connection,
and it respects light and dark.

---

## 5. Indexing, previews and caching

**A correction worth stating, because the obvious combination is wrong.** An
earlier draft called for both an `X-Robots-Tag: noindex` header **and** a
`Disallow` in `robots.txt`. Those fight each other: `robots.txt` stops the crawler
fetching the page, so it never sees the `noindex` header, and a URL discovered
through a link can still be listed. The correct answer is the smaller one — **serve
`X-Robots-Tag: noindex, nofollow` and leave the landing site's `robots.txt`
exactly as it is** (`Allow: /` with its sitemap). Also `Referrer-Policy:
no-referrer`, so a token never travels in a `Referer`.

**The link-preview card is deliberately generic** — logo and "Your receipt", with
no amount, no items, no bill number. A chat app fetches the page to build that card
the moment the link is pasted, and a card carrying the contents would spill them
into every group the link is forwarded to before anybody opened it.

**Cache with a short TTL, in minutes.** An earlier draft said "cache on the token"
as if a bill were immutable; it is not, and a long TTL would serve a valid-looking
receipt for a bill voided minutes ago. A short TTL captures nearly all the benefit
anyway, because the download tap arrives seconds after the page load and that is
the repeat hit worth eliminating. Revoking or voiding purges the entry so the
change is visible immediately.

---

## 6. The Share button

It goes in the action row that already exists at the bottom of
`manager-bill-detail.tsx`, rendered when `bill.status !== 'void'`, and it goes
**first**, so `Cancel this bill` stops being the first control a thumb reaches
when a bill expands.

Behaviour, in order of what the device supports:

1. **Native share sheet** (Web Share API). On the owner's phone this is the real
   system sheet with WhatsApp in it, which is the intended path.
2. **Clipboard**, with the button confirming `Copied`.
3. **Neither** — show the link as selectable text and **do not claim it was
   copied**.

That third case is not hypothetical, and the repo has already paid for the lesson:
[`account-handover.tsx`](../../../src/features/accounts/account-handover.tsx)
carries the comment *"Clipboard access can be unavailable on an ordinary HTTP
tablet... do not imply it was copied."* **Reuse that pattern; do not write a
second one.**

Both the owner's and the franchise admin's Billing history render this same
component, so one change serves both roles and neither gains visibility it did not
have — the button reads a link on a bill the role can already see. A void bill gets
no button, because the row already hides on void and a cancelled bill is not
something to proactively send; links already sent to a since-voided bill keep
working and say `Cancelled`.

In **demo mode** the button works and yields a token that deliberately does not
resolve. A demo that hands out a live URL over fixture data is a demo that leaks.

---

## 7. Two repos, one change

The Worker lives in **[`abdatta/shawarmania`](https://github.com/abdatta/shawarmania)**
— the landing repo — because it owns the domain, the Cloudflare zone is configured
against that site, it already runs the same OpenSpec workflow, and this repo's
`deploy.yml` has nothing to do with Workers. It is checked out locally at
`C:\Users\iamro\Code\shawarmania` as a sibling of this repo.

That repo is today a **fully static Vite bundle on GitHub Pages**. The Worker is
the first server-side code it has ever held, and the first thing in it holding a
secret, so its change carries the deploy and secret-handling story.

**This change is the parent.** `tasks.md` here drives the companion change
`public-bill-receipt-page` there to completion and gates on it, so a session that
applies this one applies both. The two halves are useless separately: a link with
nothing to open, or a page with no link to serve.

The customer-facing look belongs to the **brand** site's visual language, not the
ops portal's. `AGENTS.md` is explicit that the ops app is deliberately dense and
utilitarian; this receipt is the only surface in the whole system a customer ever
sees, and it should look like Shawarmania.

---

## 8. Sequencing

- **#35 `multiple-billing-devices`** is implemented on `main` but **not yet
  archived**. #53 requires it archived before its `counter-billing` delta applies.
- **#53 `a-discount-is-a-line-on-the-bill`** is proposed, not built. **This change
  assumes it is built and archived first**, at the owner's instruction, because the
  receipt renders discount lines, the round-up and the ₹1 floor, and building
  against the pre-discount bill shape would mean rebuilding the page immediately.
- **This change (#54) touches `counter-billing` too** — one button in the action
  row — so it applies its delta after #53's, and must not restate or contradict
  #53's discount requirements.
- **The DNS move is not on the critical path for most of the work.** Everything in
  this repo, and the Worker and page in the other, can be built and tested against
  a `workers.dev` URL. The apex route is the last step.
