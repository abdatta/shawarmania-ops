# Design: activation-without-typing

> **Model**: Opus · **Wave**: B · **Depends on**: #4, #15

## Context

Activation today is `redeem-invite`: an unauthenticated Edge Function that takes
an **email**, a **code** and a **password**, and calls
`redeem_account_invite(p_email, p_code_hash)`. The SQL function looks the person
up by address first and only then compares the code hash.

That ordering is what makes the address a required field, and the required field
is what makes the screen hard. Somebody on their first day, on a phone, types an
address they may have only heard once and a ten-character code out of a WhatsApp
message — and every failure returns the same `invalid_code`, deliberately, so
the endpoint cannot be asked "does this address have an account?". The
uniformity is right and the cost is real: the two most common mistakes are
indistinguishable from each other and from a genuine refusal.

Two facts make the fix available now and not before:

- **`code_hash` is a plain SHA-256 of the normalised code.** The code alone
  identifies the invite. The address is being used as a lookup key for a row the
  code already finds.
- **`outlet-and-staff-setup` (#15) made the address visible and correctable** on
  People and Access. Before that, "that's not my email" had nowhere to go.

What exists to build on: `account_invites` with a partial unique index giving at
most one live invite per profile; `issue_account_invite` and
`redeem_account_invite`, both service-role only; the `/activate` route already
registered ahead of the dynamic `:roleSegment` segment; `IssuedCodePanel` on
People and Access, which since #15 shows the address the account will sign in
with.

## Goals / Non-Goals

**Goals:**

- One field on the activation screen: the password. Nothing else is typed.
- A link that carries the code, sendable over WhatsApp exactly as the code is
  today — no domain, no mail provider, no DNS.
- A QR beside the code, for handing over in person.
- The address shown for confirmation, with a real "that's not my email" branch.
- A guessing bound that survives the loss of per-invite attempt counting, and a
  decision on whether an admin can see it being consumed.
- Every remaining failure names the thing that was wrong.

**Non-Goals:**

- **No email delivery.** No verified sending domain exists. Once a link carries
  the code, an emailed link carries no capability a WhatsApp link does not.
- No self-service password reset — still
  [`todos/self-service-password-reset.md`](../../todos/self-service-password-reset.md).
- No change to sign-in, which legitimately needs the address. Its copy changes;
  its mechanics do not.
- No change to how a session is minted: activation still sets a password and
  then signs in through the ordinary path (#4 design D5).

## Decisions

### D1 — The code becomes the lookup key, and the email field disappears

`redeem_account_invite` is replaced by a two-argument form —
`(p_code_hash text, p_max_attempts integer default 5)` — that finds the invite
by `code_hash` among live rows and derives the profile from it. The old
three-argument form is dropped in the same migration.

Dropped rather than left in place. It is service-role only and unreachable from
any client, but it is an address-keyed redemption path whose entire risk profile
is "if this were ever granted to `anon`, it is an enumeration oracle". Dead code
shaped like that should not linger.

*Rejected: keeping the email as a second factor.* It is not one. Anyone holding
the code can read the address off the confirmation screen this change adds, so
requiring it would gate nothing while restoring the field the change exists to
remove.

### D2 — A live invite's code hash is made unique by the database

```sql
create unique index account_invites_live_code
  on public.account_invites (code_hash)
  where consumed_at is null and superseded_at is null;
```

Lookup by address was unambiguous because of the existing one-live-invite-per-
profile index. Lookup by code needs its own guarantee, and "the codes are 50 bits
so a collision is impossible" is an argument, not a constraint. The index is also
the lookup's index, so it costs nothing.

### D3 — The per-invite attempt counter is retired, not merely kept

The proposal says keeping `attempts` "costs nothing and should stay". Once the
code is the lookup key it stays but stops *working*, and that is worth being
exact about: a wrong code now matches no row, so there is no row to charge the
attempt to. The counter can no longer be incremented by the thing it existed to
bound.

So the column stays (released schema, historical rows, no value in churning it)
and the endpoint limit in D4 becomes the **only** guessing bound. The number is
removed from the People and Access UI, because a counter that can only ever read
zero is worse than no counter: it looks like a control that is holding.

*Rejected: charging an attempt when a correct code fails for another reason
(expired, superseded, deactivated).* That is a legitimate person with a
legitimate code, not a guesser. Counting it would punish the only case where the
counter could still move.

### D4 — The guessing bound moves to the endpoint, in Postgres, counting failures only

A new table, written only by the security-definer redemption function:

```sql
create table public.invite_redemption_attempts (
  id bigint generated always as identity primary key,
  ip_hash text,                       -- sha-256, never the address itself
  attempted_at timestamptz not null default now()
);
```

**Failures only.** A successful activation writes nothing, so a shop onboarding
ten people in a morning from one connection spends none of its budget. A blind
guesser produces nothing but failures, so the limit lands entirely on them.

**Limits: 20 failures per address and 500 globally, each per 15 minutes.**

Deliberately loose, and the global one deliberately far looser. Against 50 bits,
500 tries a quarter-hour is about 2^15 a day and still some 2^34 short of
mattering, so tightening it buys nothing measurable — while a *tight* global
bound is itself an attack: a few hundred deliberate failures would stall every
real activation for the rest of the window. The limit's job is to convert "the
search space is big" back into a bound the design states.

**The notice threshold, not the limit, is the number meant to be reached.**
Twenty-five failures in a window raises the banner in D10 — a twentieth of the
hard stop. Somebody finds out long before anybody is refused.

The check runs **before** any invite is looked at, inside the same
security-definer function, so a limited caller learns nothing about any code.

Old rows are deleted opportunistically on write (anything past the window), so
the table stays small without a scheduled job.

*Rejected: in the Edge Function.* Edge Functions are stateless and horizontally
scaled; there is no shared counter there. The database is the only shared state,
and the function doing the checking is already one transaction.

### D5 — The IP is hashed, and the per-IP limit is honestly best-effort

The Edge Function reads `x-forwarded-for` and passes a SHA-256 of the first
entry. Two consequences, both recorded rather than glossed:

- **Hashed** because this table would otherwise accumulate the IP addresses of
  staff activating accounts — personal data, indefinitely, for a counter that
  only needs equality. A hash counts just as well.
- **Best-effort** because a client can prepend its own `x-forwarded-for`. The
  per-IP limit therefore stops one careless or noisy client from eating the
  global budget; it does not stop a determined attacker. **The global limit is
  the real backstop**, and it is the one that cannot be evaded by header
  manipulation.

### D6 — Being rate-limited is allowed to say so

`weak_password` is already an exception to the uniform refusal, because it
describes the request and not any account. A rate-limit refusal is the same
shape: "too many attempts from here" reveals nothing about whether any address
has an account, any code exists, or any invite is live.

So the endpoint returns a distinct `rate_limited`, and the screen says so. The
uniform `invalid_code` continues to cover every code-shaped failure — unknown,
expired, consumed, superseded, deactivated — exactly as before.

### D7 — The link is `…/activate?code=XXXXX-XXXXX`, and the address is never in it

Built client-side from `window.location.origin` and Vite's `BASE_URL`, so it is
correct under the GitHub Pages sub-path today and under a custom domain later
with no code change. `/activate` is already a static segment outranking
`:roleSegment`, and Pages' `404.html` fallback preserves the query string.

The address stays out of the URL: it would solve nothing the code does not
already solve, and would put personal data into browser history, link previews
and every proxy in between.

The link is a bearer credential — the same one the code already is, with the same
seven-day life and single use. It will sit in a WhatsApp thread; the expiry is
what bounds that.

### D8 — The link opens on a confirmation, not on a password field

The activation screen has three states:

1. **Checking** — a preview call resolves the code to the address it belongs to.
2. **Confirming** — "You will sign in as `x@y.z`", with an explicit **Yes, that's
   me** beside an equally prominent **That's not my email**. Never a passive
   Continue: a passive one gets clicked unread, and catching the admin's typo is
   the entire point.
3. **Setting a password** — one field.

The invalid-link state is reached in step 1, **before anything is typed**. That
is most of the UX win: a dead link says so on arrival rather than after somebody
has composed a password.

*Rejected: asking them to retype the address as a check.* It catches the admin's
typo and introduces its own — a false alarm on the one screen that must never
produce them — and adds typing to the change that exists to remove it. Reading an
address and recognising it is wrong is the whole job.

**"That's not my email" leads somewhere**: it tells them to ask their manager,
who can fix it on People and Access since #15. This is why the two changes are
sequenced this way.

### D9 — Preview is an action on `redeem-invite`, not a second function

`{ action: 'preview', code }` returns `{ email }`; `{ action: 'redeem', code,
password }` sets the password. One function, because they share the code path
that matters — the rate limiter, the normalisation, the uniform refusal — and
splitting them would mean maintaining that agreement across two deployments.

Preview counts against the same limits and its failures count the same way. It is
the more disclosing of the two, and it is safe for exactly the reason the
proposal gives: anyone who can ask has already proven possession of a valid,
unexpired, single-use code **for that specific account**, so the only address
they can learn is the one on the account they already hold. The objection to
revealing an address disappears precisely when the email stops being the key.

Preview does **not** consume the invite, and does not advance any per-invite
state. Only redemption does.

### D10 — An admin can see the global limit being consumed, and it is the Super Admin

The proposal owes a decision. It is **visible**, minimally: a
`security definer` function returning the failed-redemption count in the current
window, executable by an authenticated Super Admin, surfaced as a banner on
People and Access when the count crosses a notice threshold.

Super Admin only. A burst of failed redemptions is a brand-wide signal about the
endpoint, not an outlet's operational business, and the owner is who acts on it —
the same reasoning that put the geofence in the Super Admin's hands (#5 design
D4).

*Rejected: invisible.* A limit nobody can observe being consumed gives a targeted
attempt no signal at all, and a burst of failed redemptions is the only signal
one produces.

*Rejected: a full attempt log screen.* There is nothing in a hashed IP and a
timestamp that an admin can act on beyond "something is happening". The count is
the actionable part.

### D11 — The QR renders client-side, from fixed tokens, never from an image service

`qrcode-generator` (MIT, dependency-free) renders to an SVG in the page. A QR
built by fetching `chart.googleapis.com` or any equivalent would break the
demo-mode rule that no request leaves the app origin — and would hand a third
party a live bearer credential on the way.

QR modules are not a colour choice: most scanners will not read an inverted code,
so the mark cannot follow the theme. Rather than putting hex in a component, two
tokens are added to the brand layer — `--qr-module` and `--qr-field` — fixed to
black on white in **both** themes. The component reads tokens like every other
component; the tokens simply do not vary.

### D12 — The panel offers the link first, the QR second, the code last

All three, in that order. The link is what makes activation one tap, so it is
primary and it is what the Copy button copies. The QR is for handing a phone
across a counter. The raw code stays because not every handover is a link — and
because it is what a person reads out over a phone call.

### D13 — Sign-in copy says where the address came from

The sign-in screen still needs the address typed; that is legitimate. Its label
gains the one sentence that makes it answerable: *the email you gave your
manager*.

## Risks / Trade-offs

**A link in a WhatsApp thread is a bearer credential.** → Unchanged from the code
it replaces: seven days, single use, superseded by reassignment or reissue. The
change adds no new exposure; it moves the same secret into a tappable form.

**The per-IP limit is spoofable.** → Stated rather than hidden (D5). The global
limit is the backstop and cannot be evaded that way; D10 makes its consumption
visible.

**A shared connection could trip the per-IP limit.** → Only failures count, so a
normal onboarding spends nothing. Twenty failed attempts from one shop in fifteen
minutes is already a situation somebody should look at.

**The global limit is a denial-of-service lever**: 100 deliberate failures stalls
every activation for fifteen minutes. → Accepted. The alternative is no global
bound, and the affected action is "activate an account today", not "run the
business". D10 makes it visible when it happens, which is what turns a stall into
a diagnosis.

**Preview reveals an address to a code-holder.** → Intended, and safe only
because the code is now the key (D9). If anything ever reintroduces address-keyed
lookup, preview must be reconsidered in the same breath.

**Deploy ordering.** → See below; a short window where redemption fails
transiently, consuming nothing.

## Migration Plan

1. `supabase db push --linked` — the new table, the unique index, the replaced
   redemption function, the pressure function.
2. `supabase functions deploy redeem-invite` (and `admin-accounts` if touched).
3. Push `main`; Pages builds and deploys the client.

Between steps 1 and 2 the deployed `redeem-invite` calls a signature that no
longer exists: the RPC errors, the function returns its uniform `invalid_code`,
and **nothing is consumed** — an activation attempted in that window is a
retryable failure, not a burnt code. Outstanding codes remain valid throughout;
`code_hash` is untouched by the migration.

Rollback is the reverse: redeploy the previous function and re-create the
three-argument SQL function from the #4 migration. No data is lost either way,
because nothing is rewritten — the migration only adds.

## Open Questions

None outstanding. The two the proposal left open — the endpoint limit and admin
visibility — are decided in D4 and D10.
