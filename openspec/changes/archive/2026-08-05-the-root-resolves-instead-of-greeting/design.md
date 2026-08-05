## Context

The root route renders a card describing the product with one working control on
it, a link to sign-in. Three facts make it the wrong screen:

- The marketing site is separately hosted at `shawarmania.in` and stays that way
  by requirement (`pwa-and-deployment`). The operations origin serves only people
  getting into the app.
- `Landing` redirects only on `state.status === 'ready'`. The other three states
  fall through to the card, so a signed-in person sees marketing copy flash
  before their shell. The manifest's `start_url` is `.`, so this is every cold
  launch of the installed app.
- The card's only route onward duplicates what sign-in already is.

Underneath sits a second-order cost. `useRealSession` is a hook, so its state is
per component: `Landing` resolves the session, redirects, unmounts, and
`RealRoot` mounts and resolves the same session again from `{status: 'loading'}`.
`resolveSession` reads profile and assignments in parallel, so one cold launch at
the root is four requests and two placeholders for one question.

Activation carries a third, unrelated-looking problem that is the same problem:
a screen offering something nobody asked for. `activate.tsx` has a `need-code`
state that asks the person to type a one-time code, while
`identity-and-access/spec.md` already requires that "The code itself SHALL NOT be
typed" and the issuing panel deliberately shows only a QR, the link, and a copy
action. The form asks for a value the app never hands anybody.

Constraints that bind this change: the demo tree must never construct a Supabase
client (the demo-scope tripwire in `getSupabaseClient()`), the four session
states in `RealSessionState` are already correct and are not being redesigned,
and nothing here touches RLS, money, or the outbox.

## Goals / Non-Goals

**Goals:**

- Make the root a resolver with defined behaviour in all four session states, and
  make "not yet known" structurally incapable of being read as "signed out".
- Resolve the real session once per visit rather than once per screen, without
  putting a real-session read anywhere near demo mode.
- Remove the typed-code activation path and the route that reaches it, bringing
  the code into line with a requirement already in force.
- Leave sign-in as the app's front door, composed like a front door.

**Non-Goals:**

- Changing what a session is, how assignments derive it, how deactivation ends
  one, or the revalidation cadence.
- Making the app open offline from a cold start. A signed-in person with no
  network resolves to `unavailable` because the profile read needs the network;
  role shells already do this, and the root's card was only masking it at one
  path.
- Changing demo mode's behaviour, including where its exit goes.
- Redesigning the sign-in or activation forms beyond deleting the code field and
  centring the card.

## Decisions

### D1. The root renders a resolver, not a screen with a loading state

`Landing` becomes a component with no copy of its own and one job: map four
session states onto four outcomes. `loading` shows the app-boot placeholder,
`ready` navigates to the role home, `anonymous` navigates to `/sign-in`,
`unavailable` shows the retry card.

The alternative was a router-level redirect: make `/` a route with
`loader: () => redirect('/sign-in')` and let the shell bounce signed-in people
back. Rejected because a loader redirect has to decide before the session is
known, which is exactly the thing that must not happen. It would send every
signed-in person through sign-in on the way to their own shell, converting a
cosmetic flash into a wrong destination.

A second alternative was deleting the root route and letting `/` fall to
`NotFound`. Rejected: `start_url` is the root, so this is the installed app's
front door and it has to resolve to something.

### D2. `anonymous` is the only state that reaches sign-in, and it is already a confirmed negative

This is the crux, and the good news is that `useRealSession` already draws the
line correctly and no new machinery is needed to trust it. `currentUser()` calls
`auth.getSession()`, which reads persisted local state and makes no network
request, so `{kind: 'anonymous'}` at `resolveSession`'s early return is a
*confirmed* absence rather than a failed lookup. Every failure path returns
`indeterminate`, and `indeterminate` never becomes `anonymous`: the reducer only
promotes it to `unavailable`, and only from `loading`, so a working session is
never downgraded by one bad request.

So the rule is enforced by which state the root reacts to, not by an extra guard.
`anonymous` redirects; `unavailable` does not.

Rejected: adding a "confirmed" flag or a retry-before-redirect delay to the
session state. Both would add a second mechanism to keep correct alongside one
that is already correct, which the existing hook documentation warns against for
the deactivation signal for the same reason.

### D3. `unavailable` at the root reuses the role shell's retry card, verbatim in behaviour

`RealRoot` already answers this state with "You are still signed in, the app just
could not confirm it" plus a retry button. The root adopts the same card and the
same sentence rather than inventing a variant, because it is the same fact about
the same session. Sending this state to sign-in would ask somebody to retype a
password for a session they still hold, which D2 exists to prevent.

Rejected: showing the placeholder indefinitely and letting the 5-minute
revalidation interval eventually resolve it. A wait with no explanation and no
control is worse than a sentence with a button, and `LoadingRegion` announces
"loading" to a screen reader, which would then be a lie.

### D4. The app-boot placeholder becomes a named composition in `loading.tsx`

`RealRoot` composes a header strip plus a content block inline. The root needs
the identical shape, and `loading.tsx` states its own rule for this case: the
shapes that actually recur are exported as named compositions. So the boot shape
joins `LoadingList`, `LoadingBlock`, `LoadingTable` and `LoadingFigures` as a
fifth, and both call sites use it.

This matters beyond tidiness: the root hands off to the shell, so if the two
placeholders differ at all, the handoff reads as two separate loads rather than
one. Sharing the component makes them the same by construction.

### D5. The session holder is a pathless layout route wrapping the public and role branches, with demo left outside

React Router's pathless layout route (a route with `Component` and no `path`)
contributes no URL segment, so wrapping two of the three top-level branches
changes no path and no ranking. The static-outranks-dynamic property noted in
`routes/index.tsx` is a function of the child paths, which are untouched.

```
/demo          DemoGate            <- sibling, outside the provider
(no path)      RealSessionProvider
  /            RootLayout          (root resolver, sign-in, activate, 404)
  /:roleSegment RealRoot
```

**Why demo must be outside, stated precisely.** `getSupabaseClient()` throws when
demo scope is active. A provider above `/demo` would call `currentUser()` inside
the demo tree, and `resolveSession` wraps that call in `try/catch` and returns
`indeterminate`. So the tripwire would fire and be swallowed: the failure would
be silent, not loud. That is the worst of both worlds and it is an argument for
making the situation impossible structurally rather than relying on the tripwire
to report it.

Rejected: a provider at the top of the tree with a "skip if demo" condition
inside it. That is the same structure with a runtime guard standing in for the
structure, and it puts the demo seam's correctness inside a conditional that a
later edit can quietly break.

Rejected: a React context created outside the router and populated by whichever
branch mounts first. It removes the route-shape question by making mount order
the contract instead, which is harder to reason about and no easier to test.

### D6. The provider supplies state; it never gates rendering

The provider renders its `Outlet` unconditionally. It does not show a placeholder
for `loading`, because it sits above sign-in and activation, and those screens
need no session: gating there would put a shimmer in front of the login form,
which is worse than the flash this change removes.

Each consumer decides instead. The root and `RealRoot` show the boot placeholder;
`SignIn` and `Activate` ignore session state entirely and render immediately.

This also keeps the change cheap for anonymous visitors: `resolveSession` returns
at `if (!user)` before any network call, so an anonymous person at `/sign-in`
costs one local read.

### D7. `revalidate` and `endSession` move to the context, and the hook stays

The provider calls `useRealSession()` once and publishes `{state, revalidate,
endSession}`. `RealRoot` reads `endSession` for the account menu and `revalidate`
for the retry button from context instead of from its own hook call. The hook
itself is unchanged, so its eleven tests keep testing the same unit; what changes
is that exactly one component calls it.

A consequence worth naming: signing in gets faster for free. The hook's
`onAuthChange` listener is already registered, and it is now registered *above*
the login screens, so completing sign-in resolves the session once in place
rather than having the destination component start from `loading`.

### D8. Activation loses the typed-code state entirely, and the route into it goes with it

`need-code`, `typedCode` and `onCodeSubmit` are deleted. The `State` union becomes
`checking | form | dead`, and a mount with no `?code=` starts at a `dead` state
whose message says the link is incomplete rather than that it is invalid, because
those are different facts and the person can act on the first one.

The link at `sign-in.tsx` goes too, since it exists only to reach the deleted
state. The sentence that remains covers both the people who used to follow it:
one line telling anybody without a working password to ask a Franchise Admin or
Super Admin for a one-time link, which is already true for a first activation and
for a forgotten password alike.

The owner confirmed the phone-dictation fallback is not wanted. Recorded because
it is the one thing this closes: with no code field, a code read aloud over a
call has nowhere to go, and the answer becomes a reissued link.

### D9. Sign-in is centred like the app's other standalone cards

`min-h-dvh items-center justify-center`, the same treatment `Unplaced` and the
`unavailable` card already use. Now that sign-in is what the root resolves to for
a signed-out visitor, it is a screen in its own right rather than content inside
a longer page, and it should be composed as one.

### D10. No RLS, money, or offline semantics change

Stated explicitly because the contract requires it. No policy, migration, or
table is touched; the database is not involved in this change at all. No
arithmetic of any kind is involved, so the integer-paise rule has nothing to
bind. The outbox is untouched, and the counter's no-blocking-on-network guarantee
is unaffected because nothing here runs on the counter's write path. Authority
still comes from assignments resolved server-side and enforced by RLS; this
change alters only which component asks for them and how often.

### D11. A credential screen leaves when the session says so, not when the credentials are accepted

**Found during implementation, by the auth suite, after every mocked test passed.**
Recorded in full because it is the one non-obvious consequence of making the root
a resolver, and the next person to touch either credential screen needs it.

Accepted credentials and a resolved session are two different moments. The
provider computes `anonymous` when sign-in loads, and learns better from its
`onAuthChange` listener a tick later, after `getSession()` plus the profile and
assignment reads. Sign-in used to navigate to `/` the instant `signIn()` resolved,
which landed in a resolver still holding that stale `anonymous` — so the root did
exactly what D2 tells it to and sent the person back to sign-in. Signed in,
looking at a password field. Fifteen auth-suite cases failed on it; the whole
role-routing group is downstream of one helper.

So both credential screens now wait: on success they mark themselves accepted,
call `revalidate()`, and navigate from an effect once the session reports `ready`
or `unavailable`. `unavailable` leaves too, because the credentials were accepted
and a retry belongs on the screen whose subject is a session that could not be
confirmed, not on the one that just succeeded. `busy` deliberately stays set
across the wait: there is nothing left to submit, and re-enabling the button would
invite a second submission of a sign-in that already worked.

This is not a flaw in D2. "Confirmed absent" was correct when it was computed; it
simply goes stale at the one moment the app itself causes a session to exist, and
the screen that caused it is the one place that knows. Nothing about the root
changes.

Rejected: having the root treat `anonymous` as provisional and wait before
redirecting. That reintroduces exactly the ambiguity D2 removes, and would make
every genuinely signed-out visitor wait behind a placeholder for a session that
does not exist.

Rejected: having sign-in navigate straight to the role home it could compute
itself. It would need the assignments to know which one, which is the session it
is trying not to wait for, and it would put role-routing logic in a second place.

**Why the mocked tests missed it.** The existing sign-in test asserted
`pathname !== '/sign-in'` immediately after the click, which passed by racing the
redirect rather than by preventing it. The replacement waits for the dust to
settle and asserts the actual destination, and was confirmed to fail against the
old navigate-immediately code.

## Risks / Trade-offs

- **A provider above the public branch could creep toward gating it** → D6 is the
  rule that prevents it, and the test that pins it asserts the sign-in form is
  present while session state is `loading`. A future edit that adds a
  placeholder to the provider fails that test.
- **A future route added at the top level might land outside the provider by
  accident and lose the shared session** → the two branches that need it are
  nested under it, so a new sibling is visibly a sibling. The single-resolution
  test covers the root-to-shell handoff, which is the case that matters.
- **Removing the root's card removes the screen the demo exit lands on** → 
  accepted and specified. The exit serves the owner who was demonstrating;
  arriving at the way in is correct, and a prospect has no reason to leave the
  demo. `demo-safety.test.tsx` keeps asserting the exit points at `/`.
- **The offline gate primes at the root** → it asserts the header banner and
  build version, both of which live in `RootLayout`, which still wraps sign-in.
  With no stored session, `getSession()` resolves locally to null with no network
  needed, so the root resolves to sign-in offline and the assertions hold. Worth
  re-running rather than reasoning about, and the task list says so.
- **Deleting the typed-code path is irreversible for anybody mid-activation with
  only a code** → nobody can be in that position, because the issuing panel has
  never displayed a bare code. The stored codes themselves are untouched; every
  outstanding link keeps working.
- **Two placeholders could still be visible if the handoff re-mounts** → this is
  what D5 and the single-resolution test exist to prevent. If the test proves
  hard to write at the component level, the fallback is asserting the profile
  read happened once, which is the behaviour that actually matters.

## Migration Plan

No data migration and no deploy sequencing. The change is UI and routing only,
ships in one commit, and rolls back by revert. Outstanding activation links and
live sessions are unaffected; a person mid-session sees nothing change except
that the root stops flashing a card at them.

## Open Questions

None. The two that were open are decided and recorded: the demo exit stays
pointing at the root (D5 risk table), and the phone-dictation fallback is not
kept (D8).
