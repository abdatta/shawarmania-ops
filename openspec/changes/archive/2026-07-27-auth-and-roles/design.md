# Design: auth-and-roles

## Context

`data-model-and-tenancy` (#2) already built most of the *server* half of this
change and left it dormant:

- `profiles` mirrors `auth.users` one-to-one (`profiles.id = auth.users.id`),
  carrying `role`, `outlet_id`, `is_active`.
- `custom_access_token_hook` injects `app_role` and `app_outlet_id` into every
  issued token; `supabase/config.toml` registers it.
- Every policy in the schema already begins with `public.app_account_active()`,
  so a deactivated account reads nothing and writes nothing **the instant the
  flag flips** — no token refresh involved. The REST probe suite proves it.
- Seeds create eleven email/password users covering all four roles, both
  outlets, one deactivated account and one revoked device.
- `supabase/config.toml` already sets `enable_signup = false` globally with
  `[auth.email] enable_signup = true` (GoTrue's confusingly-named flag that
  gates email *sign-in*), `enable_confirmations = false`.

`demo-mode-and-app-shell` (#3) left the *client* half waiting:

- `Session` is a discriminated union whose `real` variant nothing constructs.
- `SessionContext` / `useSession()` exist; `PhoneShell` and `CounterShell`
  consume them and deliberately do not branch on mode.
- `getSupabaseClient()` is configured with `persistSession`, `autoRefreshToken`
  and a fixed `storageKey` (`shawarmania.auth`).
- `SupabaseOutletsAdapter` exists and is unused.
- `/` renders a landing that says "sign-in arrives with auth-and-roles".
- The gate registry holds each role's home in `demo`; **nothing is `live`**, so
  a real signed-in user today would land in a shell with no surfaces at all.

So this change is mostly wiring, plus exactly one genuinely new mechanism:
**admin provisioning with a one-time code**, which needs a new table, two Edge
Functions, and the security thinking that comes with an unauthenticated
password-setting endpoint.

Constraints that bind the decisions below:

- The service-role key never reaches the browser (AGENTS.md). Provisioning and
  redemption therefore run in Edge Functions.
- Being an Edge Function is not authorisation — every admin function re-derives
  the caller's role and outlet from their JWT (`docs/ROLES_AND_PERMISSIONS.md`).
- Every outlet-scoped table ships its RLS policy **and** its isolation test case
  in the change that creates it.
- Demo mode must stay structurally incapable of reaching Supabase. Any surface
  promoted to `live` renders in demo mode too, so it needs a mock adapter.
- No SMS provider, no mail delivery, no external dependency of any kind.

## Goals / Non-Goals

**Goals:**

- Real sign-in for all four roles, landing on the role's own shell.
- The real session provider behind the interface #3 defined, so no shell or
  feature component changes.
- Admin provisioning end to end: create an account, get a one-time code, hand
  it over, the person redeems it and sets a password.
- Deactivation that bites immediately — in the database (already true) and in
  an already-open client.
- Two admin surfaces — Super Admin **People**, Franchise Admin **Access** —
  built against the seam, with mocks, so they work in demo mode as well.
- Field-tuned session persistence: months, not days.

**Non-Goals:**

- No device enrolment, no shift PIN (#9). Billers sign in with email today.
- No self-service password reset, no email delivery, no SMS.
- No signed-in password change (recorded in `openspec/todos/`).
- No HR roster (`admin-employees` stays `hidden`).
- No new feature surfaces. The four role homes from #3 are promoted, not
  redesigned.
- No Google/OAuth sign-in. `docs/ROLES_AND_PERMISSIONS.md` calls it a possible
  later convenience, not a commitment.

## Decisions

### D1 — Email + password, correcting the seed

The proposal seed said "phone number + password". That is stale: the owner
replaced it with email on 2026-07-26 and the repo already moved — `config.toml`
disables SMS entirely, the seeds create email identities, and the REST probes
sign in with `signInWithPassword({ email, password })`. This change implements
what the repo and `docs/ROLES_AND_PERMISSIONS.md` say, and the proposal has been
corrected rather than left to contradict them.

Phone numbers stay on `profiles.phone` as contact data. They are never a
credential and never an identifier for sign-in.

*Rejected: implementing the seed as written.* It would require enabling a
GoTrue SMS provider (the phone password grant is gated behind the provider flag
even with no OTP) and a TRAI/DLT registration — the exact dependency the owner's
decision existed to remove.

### D2 — The real tree mirrors the demo tree: one route branch, one provider stack

Routing gains a third branch beside `/` and `/demo/*`:

```
/                     landing (redirects to the role home when signed in)
/sign-in              email + password
/activate             redeem a one-time code and set a password
/owner  /admin  /counter  /staff       ← RequireSession → RealRoot → shell
/demo/:roleSegment/*  unchanged
```

`RealRoot` is the structural twin of `DemoRoot`: it constructs the `real`
session and **only** Supabase adapters, exactly as `DemoRoot` constructs the
`demo` session and only mock adapters. There is still no factory taking a
`'demo' | 'real'` parameter — that would be the guard D1/D2 of #3 rejected. The
role segment in the path is checked against the session's own role, so
`/admin` while signed in as an Employee redirects to `/staff` rather than
rendering someone else's shell. That check is convenience; RLS is the boundary.

*Rejected: one tree with a mode-aware provider.* It reintroduces exactly the
runtime condition the demo/real split exists to make unrepresentable.

*Rejected: putting the role in the URL as the source of truth (as demo does).*
In demo the URL is legitimately the input — there is no session to consult. In
real mode the JWT claim is the only trustworthy source, and letting the path
select the role would make a typed URL look like a privilege escalation attempt
even though RLS would refuse it. The path is derived from the session, never
the reverse.

### D3 — `account_invites`: one table, hashed codes, no client write path

Provisioning needs somewhere to record an outstanding code. New table:

```sql
create table public.account_invites (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  outlet_id uuid references public.outlets (id),   -- null iff super_admin
  code_hash text not null,                         -- sha-256 hex, never the code
  issued_by uuid not null references public.profiles (id),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  attempts integer not null default 0,
  consumed_at timestamptz,
  superseded_at timestamptz
);
```

It is outlet-scoped, so per the standing rule it ships its policy and its
isolation test case here. `outlet_id` is denormalised from the profile
deliberately: a policy that had to join `profiles` to find the outlet would
re-enter the recursion trap `docs/ARCHITECTURE.md` documents, and the invite's
outlet cannot drift because a reassignment supersedes outstanding invites (D7).

Read policy: Super Admin sees all; Franchise Admin sees their own outlet's.
Nobody else sees any. `insert`, `update`, `delete` are revoked from
`authenticated` and `anon` outright, like `profiles` and `counter_devices` —
every write happens with the service-role key inside an Edge Function.

**`code_hash` is not granted to clients at all.** Column-level `select` grants
list every column *except* `code_hash`, so a request that asks for it fails
with 42501 even for the Super Admin, and `select *` fails too. Adapters
therefore select explicit columns — which they should anyway. The isolation
suite asserts both halves: the other outlet's invites are invisible, and
`code_hash` is unreadable by anyone.

*Rejected: storing the code in plaintext.* An admin of an outlet could read a
colleague's live code and take over their account. Cheap to prevent.

*Rejected: bare SHA-256 with client read access.* 50 bits of entropy behind a
fast hash is ~2^50 GPU work — uncomfortable rather than impossible. Withholding
the column removes the question entirely.

*Rejected: an HMAC pepper held in Edge Function secrets.* Cryptographically
tidier, but it adds a secret whose loss silently bricks every outstanding
invite, and column grants achieve the same end with one line of SQL and no new
operational failure mode.

*Rejected: reusing GoTrue's own invite/recovery tokens.* They are delivered by
email by design; this business hands codes over on WhatsApp and has no mail
configured. Driving GoTrue's token machinery without its delivery path is more
fragile than owning a small table.

### D4 — The code: 10 Crockford characters, 7 days, 5 attempts, single use

Settles the proposal's first open question.

- **Shape**: 10 characters from Crockford base32 (`0-9A-Z` minus `I L O U`),
  rendered `XXXXX-XXXXX`. 50 bits of entropy; unambiguous read-aloud and
  retype; the hyphen and case are normalised away on redemption.
- **Generated** with `crypto.getRandomValues` in the Edge Function, returned to
  the issuing admin **exactly once** in the HTTP response and never stored in
  plaintext anywhere.
- **Lifetime: 7 days.** Long enough that a staff member who reads WhatsApp at
  the weekend is not locked out; short enough that a message sitting in a chat
  history is not a standing credential. Expiry is checked server-side against
  `expires_at`, never client-side.
- **Single use, atomically.** Redemption does
  `update … set consumed_at = now() where id = $1 and consumed_at is null and
  superseded_at is null and expires_at > now() and attempts < 5` and treats
  "zero rows updated" as failure. Two simultaneous redemptions cannot both win;
  there is no read-then-write race to lose.
- **Five attempts.** A wrong code increments `attempts`; the sixth is refused
  even if correct, and the admin must re-issue. 50 bits makes online guessing
  hopeless already — this exists so a *targeted* attempt is visible and finite
  rather than unbounded.
- **Re-issue supersedes.** Issuing a new code stamps `superseded_at` on every
  outstanding invite for that profile, so exactly one code is ever live. This
  is also the entire admin-initiated password-reset story.

### D5 — Two Edge Functions, split by trust level

`supabase/functions/admin-accounts/` and `supabase/functions/redeem-invite/`,
sharing helpers in `supabase/functions/_shared/`.

**`admin-accounts`** requires a caller JWT and re-derives authority from it
server-side — never from the request body:

| Action | Super Admin | Franchise Admin |
|---|---|---|
| `provision` | any role, any outlet | `biller`/`employee`, own outlet only |
| `reissue` | any account | own-outlet accounts only |
| `set-active` | any account except self | own-outlet non-admin accounts only |

The caller's role and outlet come from verifying their access token with the
Supabase client and reading their own `profiles` row through the service-role
client. A Franchise Admin asking to create a `super_admin`, or to touch another
outlet, gets 403 — the test suite asserts every cell of that matrix.
Self-deactivation is refused outright: locking the only Super Admin out of the
system is an easy accident with no in-app recovery.

**`redeem-invite`** takes no caller JWT at all — the whole point is that the
person has no password yet. It accepts `{ email, code, password }`, and its
threat model is completely different, which is why it is a separate function
with a deliberately tiny surface:

- Failures are **uniform**: unknown email, wrong code, expired code, consumed
  code, exhausted attempts and inactive account all return the same 400 with
  the same message. No account enumeration.
- The password is validated (≥10 characters) before anything is consumed.
- On success it sets the password via `auth.admin.updateUserById`, stamps
  `consumed_at`, and returns 204. **It never returns a session** — the client
  then signs in normally with the password just set. One code path for "how a
  session comes into existence", not two.

*Rejected: a single function with an `action` field spanning both.* The
authenticated and unauthenticated halves would share a deployment, a body
parser and a mistake surface. Their trust levels are opposite; keeping them
apart is the point.

*Rejected: returning a session from redemption.* It would be nicer by one
screen and would create a second way to mint a session — a path that must then
be reasoned about every time auth changes.

*Rejected: doing provisioning from the client with RLS-guarded inserts.*
Creating an `auth.users` row requires the service-role key. Not possible, and
not desirable.

### D6 — Deactivation bites in the client because a deactivated session reads nothing

The database half needs no work: every policy already checks
`app_account_active()`, and the REST probes prove a deactivated account with a
still-valid token reads zero rows from every table. What is missing is that an
**already-open app** would sit there showing a stale shell.

The signal is free and exact: a deactivated account **cannot read its own
`profiles` row** (the self-read arm of `profiles_select` is `and`-ed with
`app_account_active()`). So the real session provider treats "my own profile
came back empty" as the definition of deactivated, signs out, and returns to
sign-in with "Your account has been deactivated. Contact your manager."

It revalidates on mount, whenever the tab becomes visible again, and every five
minutes while open. Five minutes bounds the worst case for a phone left awake
on a counter; tab-visibility covers the realistic case (someone picks the phone
up) at zero cost.

*Rejected: polling a dedicated `am-I-active` RPC.* A second mechanism to keep
correct, when the profile read the provider already needs answers the question.

*Rejected: Realtime subscription on the profile row.* A websocket, a
reconnection story and a new dependency to detect a state change that is rare
and not urgent to the second.

*Rejected: shortening `jwt_expiry`.* It would make the *claims* fresher without
making deactivation immediate, and it costs every user a refresh round-trip on
a bad connection.

### D7 — A role or outlet reassignment ends the session, loudly

Settles the proposal's second open question.

`app_role` and `app_outlet_id` are baked into the access token at issue. After
a reassignment the open session's claims are stale: RLS enforces the *old*
scope until the next refresh, while the profile row says something new. The UI
must never render a shell the token cannot actually serve.

On every profile revalidation the provider compares `profile.role` /
`profile.outlet_id` against the claims decoded from the current access token.
On mismatch it calls `refreshSession()` once — which re-runs the access-token
hook and normally resolves it — and re-checks. If they still disagree, it signs
out with "Your role has changed. Please sign in again." Re-issuing invites is
not involved; the person's password still works.

A reassignment also supersedes any outstanding invite for that profile
(D4), so a code issued against the old outlet cannot be redeemed after the
move.

*Rejected: silently adopting the profile's new role in the UI.* That is the
one genuinely dangerous option: the shell would show Franchise Admin
navigation while every query still ran with Employee claims, producing empty
screens that look like data loss.

### D8 — Gate promotions: the four role homes, plus People and Access

A signed-in user must land somewhere. `isRenderable('demo', 'real')` is
`false`, so the four role homes have to move to `live` — they are honestly
real: each reads the outlets adapter, and `SupabaseOutletsAdapter` already
exists.

Promoted to `live`: `owner-dashboard`, `admin-dashboard`, `counter-home`,
`staff-home`, `owner-people`, and a new `admin-people` entry ("Access", the
Franchise Admin's own-outlet view of the same surface).

`admin-people` is a new registry entry rather than a promotion of
`admin-employees`, because they are different screens: `admin-employees` is the
HR roster (`employees` table, employment status, salary) and belongs with the
operations surfaces. Issuing app access is an identity concern. `docs/SCREENS.md`
gains the same distinction, and the roster will link to Access when it lands.

Because `live` renders in **both** modes, People and Access need mock
implementations as well — so `MockAccountsAdapter` ships alongside
`SupabaseAccountsAdapter`, and the existing demo-safety test (which exercises
every mock adapter method, writes included, asserting zero `fetch` calls) grows
to cover them. This is the seam working as designed, not extra scope.

*Rejected: leaving the homes in `demo` and giving real mode a bespoke landing.*
Two homes per role, diverging immediately, and the roadmap's rule is that a
surface is promoted by the change that earns it.

### D9 — The account menu is a shell slot, not a mode branch

Every signed-in user needs sign-out, and `PhoneShell`/`CounterShell` are
deliberately mode-agnostic. Rather than teach them about auth, the real tree
passes an `accountMenu` element through a new slot beside the existing `banner`
slot — the same mechanism `DemoRoot` already uses for the demo banner. The
menu shows name, role, outlet, and **Sign out**. In demo mode the slot is
simply unfilled, so nothing offers to sign out of a session that does not
exist.

`docs/SCREENS.md`'s shared **Profile** screen (change password, etc.) is not
built here; the menu covers what sign-out needs and no more.

### D10 — Session lifetime: hours for the token, months for the session

`jwt_expiry` stays 3600 with rotation on — short-lived access tokens are the
reason the claim model is safe. What matters for "a delivery employee should
not be re-authenticating weekly" is the **refresh** token, which GoTrue does
not expire by default; `persistSession` + `autoRefreshToken` (already
configured) then keep a session alive indefinitely across app restarts, and
`refresh_token_reuse_interval = 10` tolerates the double-refresh a flaky
connection produces.

This is therefore a decision to **change nothing and state why**, plus one
addition: the config gains an explicit comment recording that no inactivity
timeout is set on purpose, so a future reader does not "tighten" it and lock
the field staff out weekly.

### D11 — No RLS, money or offline semantics change beyond the new table

Stated explicitly because the schema rules demand it. `account_invites` is the
only new table and it ships its policies and isolation cases here. No money is
handled anywhere in this change. Nothing touches the counter write path, the
outbox, or business-date resolution.

## Risks / Trade-offs

- **[An unauthenticated endpoint that sets passwords]** `redeem-invite` is the
  most security-sensitive surface in the app so far. → Mitigated by 50-bit
  codes, hash-at-rest, atomic single consumption, a five-attempt ceiling,
  7-day expiry, uniform failure responses, and a test suite that asserts each
  of those individually rather than trusting the composition.
- **[Provisioning authority spans two enforcement points]** RLS cannot police
  an Edge Function running as service-role; the matrix in D5 is enforced by
  code. → Every cell is a test case, including the negative ones (Franchise
  Admin creating a `super_admin`, touching another outlet, deactivating
  themselves).
- **[Billers sign in with email until #9]** A shared tablet holding a personal
  email login is exactly what `docs/ROLES_AND_PERMISSIONS.md` argues against.
  → Accepted as explicitly interim: it exists so the gate ("all four roles sign
  in") is real, it is recorded in `docs/LIMITATIONS.md`, and #9 replaces it
  before billing ships. No outlet data is at greater risk than the tablet's own
  outlet, which is what enrolment will scope it to anyway.
- **[Promoting six surfaces to `live` doubles their test surface]** Each now
  renders in two modes with two adapter implementations. → That is the seam's
  designed cost and the reason the mock exists; the demo-safety test already
  iterates adapters generically.
- **[The deactivation signal is indirect]** "Cannot read my own profile" means
  deactivated *today*, but a future policy change could make it mean something
  else. → The REST probe suite pins the property directly, so a policy change
  that breaks the inference fails a test rather than silently disabling the
  client check.
- **[Five-minute revalidation is a background query per open app]** Negligible
  at this scale (a handful of devices), and it is one indexed primary-key read.

## Migration Plan

Additive. One migration creates `account_invites` with its policies, grants and
isolation coverage; nothing existing is altered. Two Edge Functions are new
deployments. The client gains routes; no existing route changes meaning.

Rollback is reverting the change and dropping the table — no data any other
feature depends on, and no user-visible state beyond outstanding invites, which
are re-issuable by definition.

Deployment order matters once: the migration must land before the Edge
Functions, or `admin-accounts` will fail on a missing table.

## Open Questions

- Whether a signed-in user should be able to change their own password without
  an admin. Not built here (proposal non-goal); recorded in `openspec/todos/`
  so it is a decision rather than an omission.
- Whether Google sign-in mapped to the same address is worth adding once real
  staff are using the app. Deferred until someone actually complains about
  typing a password.
