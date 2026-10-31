# Tasks: a-tablet-keeps-its-login

Read `proposal.md` and `design.md` first. The production evidence and the
rejected alternatives are in the design. In particular, a redirect in `SignIn`
and `Activate` alone was rejected by the owner because it is not future-proof.
Do not reopen that without a reason the design did not consider.

**The off path is today's code, untouched.** The boundary renders the bare
`Outlet` and `signIn`/`redeemInvite` skip their check while
`a-tablet-keeps-its-login` reads off. D4, the setup race, is ungated (proposal,
*Change gate*).

## 0. Before anything

- [x] 0.1 Branch from `origin/stage`. Take the next free migration timestamp
  after the newest on `stage` (`20261110000000_a_stop_can_be_undone.sql` was the
  newest when this was written).
- [x] 0.2 Re-check that the key `a-tablet-keeps-its-login` and the code `TK` are
  unused, and that the key is not in `RETIRED_CHANGE_GATES`. Count the root
  gates in `src/change-gates/gates.ts` plus any that open change folders have
  landed on `stage`. `MAX_ROOT_GATES` is 5.
- [x] 0.3 Read `prove_counter_device_session` (the newest migration that defines
  it) and confirm it refuses a row with `removed_at` set and one whose code
  window has passed, and is a no-op for a proven row. **If it does not refuse a
  removed row, stop.** D4 would keep a removed tablet signed in, so return to the
  design.
  - Done 2026-10-31: both the proven early return and the update require
    `removed_at is null`, and the update requires `proof_expires_at > now()`, so
    a removed row and a lapsed one both return `invalid`. No existing pgTAP case
    proved either, so 3.5 adds them.
- [x] 0.4 Confirm `supabase/functions/_shared/counter-code.ts` can be imported
  by the browser bundle (no Deno globals at module scope). Decide import or
  mirror for `DEVICE_EMAIL_DOMAIN` (design D2).
  - Mirrored. The module is Deno-free, but no browser code imports `_shared`
    today, and importing it into a `src` test pulls it into the app's
    typecheck, where it fails a strict index check. `auth-tablet.test.ts` reads
    the server file as text and pins the two equal.

## 1. The gate, off

- [x] 1.1 Declare `a-tablet-keeps-its-login` in `src/change-gates/gates.ts`:
  `kind: 'change'`, `code: 'TK'`, `change: 'a-tablet-keeps-its-login'`,
  `retireBy` eight weeks after it is first turned on (write a provisional date
  and correct it at release), and `roundTrip: 'none: it changes which page a
  tablet is shown and refuses a sign-in before it is sent; nothing is written
  or queued either way'`. Add a doc comment in the shape of its neighbours.
- [x] 1.2 Migration `<timestamp>_a_tablet_keeps_its_login.sql`: one
  `insert into public.change_gates` row, off, with the title *A tablet keeps its
  login* and the proposal's On and Off sentences verbatim, `change_name`
  `'a-tablet-keeps-its-login'`, and `change_number` null (no roadmap row). If the
  column is not nullable, read how a gate without a roadmap row was inserted
  before, and follow that. Nothing else goes in the migration.
- [x] 1.3 `npm run lint:migrations` and `npm run lint:change-gates`.

## 2. The machine-identity helper (D2)

- [x] 2.1 In `src/data-access/auth.ts`, add `isDeviceEmail(email)` and
  `storedSessionIsDevice()`. The second reads `client.auth.getSession()`, which
  is local and sends nothing. Unit tests: a device email, a person alias, an
  associated email, no session.
- [x] 2.2 Expose whether `currentUser()`'s user is a machine identity (an
  `isDevice` flag on `AuthedUser`, or the email), for D4. Update the callers'
  types.
- [x] 2.3 A synchronous reader for D1's cold start: parse the stored session
  under `shawarmania.auth` from `localStorage` (wrapped in try/catch, so absent
  or corrupt reads as "not a device"). Unit-test the corrupt and absent cases.

## 3. The setup race and the lost proof (D4, ungated)

- [x] 3.1 First write a failing test in `use-real-session.test.tsx`. The user is a
  machine identity, the first `loadOwnCounterDevice` returns null,
  `proveCounterDeviceSession` resolves true, and the second read returns the
  device. Expect `status: 'counter'` and that `signOut` was **not** called.
  Run it against today's code and confirm it fails because `signOut` was called.
- [x] 3.2 Implement design D4 in `resolveSession`: machine identity and a null row,
  then prove, then read once more, then fall through as today. A throw from the
  proof is `indeterminate`.
- [x] 3.3 Tests: proof refused, so ended and `signOut` called, as removal does
  today; proof throws, so state unchanged and no sign-out; a person with no
  profile is unchanged (no proof call); a working tablet makes no proof call.
- [x] 3.4 Correct the doc comment on `proveCounterDeviceSession`, which claims a
  caller it never had, so it names `resolveSession`.
- [x] 3.5 pgTAP: `prove_counter_device_session` refuses a removed row and an
  expired unproven row, and returns ok idempotently for a proven one. Add only
  what an existing test does not already prove.

## 4. The session-writing code refuses over a tablet (D2, gated)

- [x] 4.1 `signIn` and `redeemInvite`: with the gate on (`bootSnapshot()`), call
  `storedSessionIsDevice()` first, and throw `SignInError('tablet', …)` /
  `ActivationError('tablet', …)` before any request. Add `'tablet'` to both
  error-code unions. Wording: "This is a counter tablet. Sign in on your own
  phone." ("kitchen tablet" when the kind is known to be kitchen).
- [x] 4.2 Unit tests, gate on: no `fetch` call is made, the stored session is
  unchanged, and the message is the one above. Gate off: today's behaviour,
  with the request sent.
- [x] 4.3 ESLint `no-restricted-syntax` in `eslint.config.js`: forbid member
  calls `auth.signInWithPassword`, `auth.signInWithOtp`, `auth.verifyOtp`,
  `auth.setSession`, `auth.exchangeCodeForSession` and `auth.signInWithIdToken`
  under `src/**`, except `src/data-access/auth.ts` and test files. The message
  names this change and the `storedSessionIsDevice()` check. Prove it fires with
  a throwaway call, then remove that call. `npm run lint`.
  - Written as `no-restricted-properties`, not `no-restricted-syntax`: the
    `.tsx` Loading warning already holds `no-restricted-syntax`, and flat config
    replaces a rule's options rather than merging them, so one of the two would
    have silently stopped applying. Proved with throwaway `.ts` and `.tsx`
    files (a call and a destructured `signInWithPassword` both refused, the
    Loading warning still raised), then removed.

## 5. The tablet boundary (D1, gated)

- [x] 5.1 `src/auth/tablet-boundary.tsx`: `TabletBoundary` as design D1
  describes. The allowed set is a single `mayOpen(device, pathname)`: the home
  from `homeFor(device)` (`/counter` or `/kitchen`) and every path beneath it,
  except `/counter/setup`. Unit-test it directly: `/counter`, `/counter/`,
  `/counter/expenses` open for a counter; `/counter/setup`, `/counterfeit`,
  `/kitchen`, `/sign-in` do not; the mirror cases for a kitchen. Gate off
  renders `children` only.
- [x] 5.2 Render it in `RealSessionProvider` around the `Outlet`. Update the
  provider's comment for the one case that now waits (a stored machine
  identity).
- [x] 5.3 Leave the per-screen tablet redirects in `RealRoot`, `RootResolver`,
  `CounterRoot`, `KitchenRoot` and `CounterSetup` untouched. Note them in the
  gate's doc comment as what retirement removes.

## 6. The route matrix (D3)

- [x] 6.1 `src/routes/tablet-boundary.test.tsx`: flatten every path under the
  `RealSessionProvider` branch of `appRoutes`, including every
  `roleSurfaceRoutes` child, fill the `:params` and add `/no-such-page`. Assert
  the list is non-empty and contains `/sign-in`, `/activate` and
  `/counter/setup`, so a broken flattener cannot pass vacuously.
- [x] 6.2 Run the table in design D3 for every path, with a `MutationObserver`
  asserting that no `input[type=password]` is ever attached for the tablet rows.
- [x] 6.3 Prove the matrix is future-proof: add a throwaway route to a copy of
  the route table in the test (`/forgot-password` rendering a password input),
  and assert a counter tablet still lands on `/counter` and never sees the
  input. Then add a throwaway `/counter/expenses` child of `/counter` and assert
  a counter tablet stays on it while a kitchen tablet and a person do not. Keep
  both cases. They are the owner's two questions as tests.
- [x] 6.4 `e2e-auth/`: a set-up counter tablet opens `/sign-in` and
  `/activate?code=x` and lands on `/counter`, still holding its session (a
  request after it still succeeds as the tablet). Tag it so the gate-on run
  includes it.
  - `e2e-auth/tablet-keeps-its-login.spec.ts` sets the tablet up from a real
    setup code, because the seeded tills sign in with person aliases
    (`@login.shawarmania.invalid`) rather than a machine identity. It also
    opens a role address and an unknown one, and has a `@cg-off` twin that
    still finds the sign-in form.

## 7. Verify

- [x] 7.1 The gates `verify.yml` runs locally that apply here: typecheck, lint
  (including `lint:change-gates` and `lint:migrations`), unit, and the DB gate
  for 3.5. Let a push to `stage` run the browser suites.
- [x] 7.2 Demo walkthrough: all four roles still walk. The demo is outside the
  boundary, so nothing should change.

## 8. Docs

- [x] 8.1 `docs/SCREENS.md`, `docs/SECURITY_AND_PRIVACY.md`,
  `docs/ARCHITECTURE.md`, `docs/OPERATIONS.md`, as the proposal lists. The
  OPERATIONS entry: a laptop that "lost its registration" means first check for
  a staff sign-in on it, remove the abandoned row, and attendance goes on
  phones.

## 9. Release

- [ ] 9.1 Push to `stage` (squash to a few commits first) and let the staging run
  go green. Promote with the owner.
- [ ] 9.2 Before turning the gate on, the owner asks Supratik to tell staff that
  attendance is marked on their own phones, never on the counter laptop.
- [ ] 9.3 Turn `a-tablet-keeps-its-login` on at a quiet hour. On the counter
  laptop, open `/sign-in` by hand and confirm it lands on the counter, and the
  build stamp shows `TK`.
- [ ] 9.4 The owner removes the abandoned tablets (Kalyani Counter 2, the second
  Cafe 2) from the Tablets list.

## 10. PHASE GATE

- [ ] 10.1 No roadmap row (a correction). The checkpoint is the proposal's
  **Gate** line, every item checked against the running app:
  - a set-up counter or kitchen tablet lands on its own home from `/sign-in`,
    `/activate`, a role address and an unknown address, with no password field
    ever drawn;
  - the route matrix walks the live route table and includes a later-added
    page;
  - a person's sign-in or activation on a tablet is refused before any request;
  - a fresh setup that races its proof stays signed in, and a removed tablet is
    still signed out;
  - with the gate off, `/sign-in` and `/activate` on a tablet behave as today;
  - the four-role demo walkthrough still walks.
