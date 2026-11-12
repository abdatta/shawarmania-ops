# Design: A Tablet Keeps Its Login

## The owner's words, 2026-10-31

On the cause: "propose the fix: /sign-in (and /activate) on a set-up tablet
should send it back to /counter or /kitchen instead of showing the password
form."

On making it last: "make sure that this is kind of future proof, such that new
pages introduced would not suddenly … route to it … if we add like a forget
password page or some other page, maybe a owner page, or maybe like a logged in
staff page … pages that should not be visible on a registered device, or a
registered kitchen device or registered counter device, basically have all of
them sorted properly and not be accessible one from the other."

So the fix has two halves. Close `/sign-in` and `/activate` now. Then make the
boundary **deny by default**, so an unlisted page is closed to a tablet without
anyone remembering to close it.

## What was measured before deciding

Read-only, against production, 2026-10-31.

- `counter_devices` since 2 Oct: six rows at Kalyani Cafe, all set up from setup
  codes Supratik issued away from the shop. Each tablet's **last refresh token
  is still unrevoked**. The server never ended those sessions. The browser lost
  them.
- Auth logs, 30 Oct 11:54–14:03 IST, and the matching edge logs filtered to the
  shop's IP: the counter laptop (one Windows Chrome user agent) refreshed as
  Cafe 2, read `counter_devices` and `counter_shifts`, and 21 s later posted a
  **password grant for a staff account**. It then read `profiles`,
  `assignments` and `attendance`, called `attendance_submit_attempt_v2`, and
  posted `/logout`. Cafe 2 never appeared again. Cafe 3 was set up at 14:02.
- 25 Oct 12:02–12:35: the same staff password sign-in and sign-out on the shop's
  IP, then a new tablet at 12:34:45, **signed out at 12:34:46**. The row was
  proven, then removed by the admin a minute later, and another code was
  issued.

The route table (`src/routes/index.tsx`) explains how the form was reachable.
`RootResolver`, `RealRoot`, `CounterSetup` and `KitchenRoot` each send a tablet
home in their own body. `SignIn` and `Activate` have no such branch. Each screen
guards itself, so an unguarded screen is the default.

## D1. One tablet boundary, at the top of the real route tree, deny by default

`RealSessionProvider` already wraps every real route: `/`, `/sign-in`,
`/activate`, `*`, `/counter/setup`, `/counter`, `/kitchen` and `/:roleSegment`
with all its children. A new real route is a child of it by construction, because
the demo tree sits outside it on purpose (its own comment, D5).

A `TabletBoundary` is rendered there around the `Outlet`. With the gate on:

- **The session is a tablet** (`status: 'counter'`, which also covers the offline
  resume): its home is `/kitchen` when `tabletKind(device) === 'kitchen'`, else
  `/counter`. A tablet may open its **home and anything beneath it**:
  `pathname === home || pathname.startsWith(home + '/')`. The one exception is
  `/counter/setup`, which is excluded by name because it is setup, not the
  counter. Any other pathname renders `<Navigate to={home} replace />` and
  nothing else. **The allowed set is one subtree per kind, written in one
  place.** A route added anywhere else is outside it without any edit.

  **This is how the tablet grows.** A future counter Expenses page goes at
  `/counter/expenses`, as a child route of `/counter`, and a kitchen page goes
  under `/kitchen/…`. Each is open to its tablet by where it lives, with no
  edit to the boundary. The same placement keeps it closed to the other kind of
  tablet and to people, because people never reach the `/counter` branch.
  The rule a page author follows is **"tablet pages live under the tablet's
  home"**, and the route matrix (D3) checks it in both directions.
- **The session is not known yet** (`loading`, or `unavailable`) **and the
  browser's stored session is a machine identity**: render the loading
  placeholder (or `UnconfirmedSession` for `unavailable`) rather than the child.
  This keeps the password form from flashing on a tablet while its session
  resolves. "Stored session is a machine identity" is a synchronous read of
  the stored session's user email under `shawarmania.auth`, ending in
  `@device.shawarmania.invalid` (D2's helper). No request is made.
- **Anything else** (a person, a signed-out visitor, a fresh browser): render the
  child unchanged. The per-screen redirects for people stay where they are.

With the gate off, the boundary renders the `Outlet` and nothing else, which is
today.

The provider's own comment says it "supplies state; it does not gate
rendering", because a shimmer in front of the login form is worse than a flash.
That still holds for every visitor who is not a tablet. The boundary waits only
when storage already says the browser is a tablet, which is exactly the case
where the login form must not appear. The comment is updated to say so.

**The per-screen tablet redirects stay.** `CounterRoot`'s kitchen check,
`KitchenRoot`'s counter check and `RealRoot`'s counter check become redundant
while the gate is on and are still the whole answer while it is off. Their
removal belongs to the gate's retirement, not to this change.

## D2. The session-establishing code refuses over a tablet's session

The boundary decides what a tablet is shown. It cannot stop a future screen
mounted somewhere else, a stray `client.auth.*` call, or a race inside the first
render from writing a person's session over the tablet's. So the code that
writes sessions refuses too.

- A helper in `src/data-access/auth.ts`, `storedSessionIsDevice()`, reads the
  stored session (`client.auth.getSession()`, which is local and makes no
  request) and answers whether its user's email ends with the device domain. The
  domain is `DEVICE_EMAIL_DOMAIN` in `supabase/functions/_shared/counter-code.ts`.
  `src/` already imports pure helpers from `_shared` in tests. Import it if the
  module is browser-safe, or mirror it with a unit test that pins the two equal.
- `signIn` and `redeemInvite`, with the gate on (read through `bootSnapshot()`),
  call it first. If the stored session is a device's, they throw before any
  network request: `SignInError('tablet', …)` and `ActivationError('tablet', …)`,
  with one sentence:
  > This is a counter tablet. Sign in on your own phone.
  The kitchen wording says "kitchen tablet". The helper returns the kind when the
  device row is known, and "counter" otherwise.
- **A lint keeps it the only door.** An ESLint `no-restricted-syntax` rule
  forbids `auth.signInWithPassword`, `auth.signInWithOtp`, `auth.verifyOtp`,
  `auth.setSession`, `auth.exchangeCodeForSession` and `auth.signInWithIdToken`
  anywhere under `src/` except `src/data-access/auth.ts`. A future
  forgotten-password page has to put its session write in `auth.ts`. Its review
  then sees the rule next to the `storedSessionIsDevice()` check it must call.
  Tests are exempt.

`setUpCounterDevice` is deliberately **not** guarded. It runs only on
`/counter/setup`, which the boundary already closes to a set-up tablet, and an
unconfigured browser holds no device session to protect.

## D3. A route-matrix test that walks the live route table

`src/routes/tablet-boundary.test.tsx` imports `appRoutes` and flattens every
path under the `RealSessionProvider` branch, including every child of
`roleSurfaceRoutes`. It fills each `:param` with a sample value and adds one
path no route matches (`/no-such-page`). The demo branch is left out by
construction, because it is not under the provider.

For each path, in a memory router with `useRealSession` mocked (the pattern
`root-resolver.test.tsx` already uses):

| Session | Expected |
|---|---|
| counter tablet, gate on | ends on `/counter`, and no `input[type=password]` was ever in the document |
| kitchen tablet, gate on | ends on `/kitchen`, and no password input ever appeared |
| loading, stored session is a device, gate on | shows the loading placeholder, and no password input |
| person (`ready`) | never renders `CounterRoot` or `KitchenRoot` content, at `/counter`, `/kitchen` or `/counter/setup` |
| signed out | `/counter` and `/kitchen` end on `/sign-in` via the root |
| counter tablet, gate off | `/sign-in` still shows the form, which is today, so the off path is pinned |

"Never appeared" is checked with a `MutationObserver` over the whole render, not
only the final DOM, because a flash is the bug.

Because the list is derived from `appRoutes`, **a route added later is in the
matrix the day it is added**. The expected landing is computed from where the
route lives. A path under `/counter/` (other than `/counter/setup`) is expected
to **stay put** for a counter tablet and to be left by everyone else. A path
under `/kitchen/` is treated the same way for a kitchen tablet. Every other
path is expected to send both kinds of tablet home. So a new counter page placed
under `/counter` passes without edits, and a counter page placed anywhere else
fails until it is moved. Nothing ever lets a page in quietly, and nothing makes
growing the counter a boundary edit.

One end-to-end case in `e2e-auth/`: a real set-up counter tablet opens
`/sign-in` and `/activate?code=x` and lands on `/counter` each time, its session
unchanged.

## D4. A fresh setup is not signed out while its proof is in flight

Today, in `setUpCounterDevice`:

1. `signInWithPassword` stores the machine session and fires `SIGNED_IN`.
2. `useRealSession`'s `onAuthChange` listener runs `resolveSession` at once.
3. `loadOwnCounterDevice` reads `counter_devices`. `app_device_ok()` is false for
   a row with `session_proven_at` null, so the row is invisible and the read
   returns null.
4. `loadOwnProfile` returns null, because a tablet has no profile, so the result
   is `{ kind: 'ended', reason: 'deactivated' }`, and `apply` calls `signOut()`.
5. Meanwhile `prove_counter_device_session` lands and the row is proven. The
   browser has already signed itself out.

Steps 3–4 lose the race only sometimes, which matches one bad setup out of six.

There is a second fault here. `proveCounterDeviceSession()` is documented as
"Called on start, before the app decides the tablet is unconfigured". **It has no
caller.** A setup whose proof response was lost is therefore not rescued on the
next start either. It is signed out by the same step 4.

**The fix, in `resolveSession`:** when the device read returns null **and the
signed-in user is a machine identity** (D2's domain test on `user`), call
`proveCounterDeviceSession()` and read the device once more before falling
through to the person path.

- Proof succeeds (a race, or a lost proof inside the code's window): the second
  read finds the row, and the session is a counter.
- Proof refuses (removed, or the window has passed): the second read is still
  null, and the existing fall-through ends the session, **exactly as removal does
  today**.
- Proof throws (network): `indeterminate`, which never signs anybody out.

This is idempotent server-side, as the RPC already promises. It runs only for a
machine identity with no visible row, which a working tablet never is, so a
trading tablet makes no extra request.

**Before relying on it, read `prove_counter_device_session`** and confirm with a
pgTAP case that it refuses a removed row and an expired one. If it does not, the
removed-tablet sign-out above would break, and this design is wrong.

Ungated, for the reason given in the proposal. A gate answer cannot reach a
browser that has never run the app, and that is the browser setup runs on.

## The gate

`a-tablet-keeps-its-login` (*TK*), `kind: 'change'`, depends on nothing.
Roots after it: `pro-rata-pnl`, `auto-approve-at-the-shop`, the waiters change's
root gate(s) if they have landed, and this one. Re-count at task 0.2 against the
limit of five.

`roundTrip`: `none: it changes which page a tablet is shown and refuses a
sign-in before it is sent; nothing is written or queued either way`.

A tablet reads the gate from its saved answers (`shawarmania.change-gates`),
which survive a person's sign-out because they are a different storage key. So
a counter that has run with the gate on keeps the boundary on at its next cold
start, before any gate refresh.

## Version skew

**No database object is added, edited or dropped**, apart from the gate's own
row and its insert migration (`change_gates`, one row, off). A build published
before this change never reads that row and behaves as today. A build after it
reads the row as off until the owner turns it on.

D4 calls `prove_counter_device_session`, which every build since #36 already
calls. Its signature and behaviour are unchanged.

Turning the gate off persists nothing to undo. The boundary stops redirecting,
and `signIn`/`redeemInvite` stop refusing.

## RLS and authority

No policy changes. The boundary is a UI convenience. The database still refuses
a tablet everything a tablet may not do, whatever page is drawn. D2 protects the
**browser's** session slot, which no policy can reach.

## Offline

A tablet resuming offline (`status: 'counter'` with `offlineResume`) is a tablet
to the boundary, and is sent home like any other. D4's proof call is a network
request. Offline, it throws, and the result is `indeterminate`, which never signs
anyone out.

## Demo

The demo tree is outside `RealSessionProvider`, so it is outside the boundary. It
has no tablet sessions to protect. No demo screen changes.

## Rejected alternatives

- **Exactly one path per tablet** (this design's first draft). The owner pointed
  out on 2026-10-31 that the counter may grow pages, such as an Expenses page
  under the counter, and the kitchen may too. One fixed path would have made
  each of them a boundary edit. The subtree rule keeps deny by default for
  everything outside the tablet's branch and lets the branch grow freely.
- **A redirect in `SignIn` and `Activate` only** (the first framing). It fixes
  the two screens found and leaves the next one open. It is the per-screen
  pattern that produced the bug. Rejected at the owner's request.
- **An allow-list of routes per role, with every route declaring who may see
  it.** Thorough, but it is opt-in. A route that forgets to declare is the
  failure, and the person side of the tree already works. Deny by default for the
  one principal that must be fenced (a tablet) is smaller and fails closed.
- **A separate storage key for person sessions on a tablet**, so a sign-in lands
  beside the tablet's session. It makes the laptop a shared personal device,
  which "no password on shared hardware" exists to prevent. It also needs two
  Supabase clients and every adapter to pick one.
- **Refusing on the server** (an Auth hook refusing a password grant from the
  counter's IP or user agent). IP and user agent are shared by every phone on the
  shop's Wi-Fi, so it would refuse staff on their own phones.
- **A marker set by `setUpCounterDevice` to suppress the session check during
  setup.** It fixes the race but not the lost proof on the next start. D4's
  "machine identity with no row, try the proof" fixes both and wires up the
  rescue the code already claimed to have.
- **Gating D4.** A fresh browser boots with every gate off, so the fix would never
  run where it is needed.
- **Automatically removing the abandoned tablets.** No browser signal identifies
  the hardware, so "set up twice" cannot be told apart from "two laptops".

## Release

Push to `stage`. The staging run is the browser suites. Promote. Turn
`a-tablet-keeps-its-login` on at a quiet hour. On the counter laptop, open
`/sign-in` by hand and confirm it lands on the counter. Before turning it on, ask
Supratik to tell staff that attendance goes on their own phones.
