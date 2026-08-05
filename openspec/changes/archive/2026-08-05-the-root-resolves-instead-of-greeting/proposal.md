## Why

The application root greets staff with a marketing card carrying one working
control, a link to sign-in. It is the wrong screen in the wrong place: the
marketing site lives independently at `shawarmania.in`, so `ops.shawarmania.in`
serves only people who already know what the app is and are trying to get into
it. Worse, the root ignores three of the four session states it already
computes, so a signed-in person opening the installed app sees that card flash
before their own shell replaces it. The manifest's `start_url` is the root, so
this happens on every cold launch.

Two smaller things sit alongside it. Activation still offers a form for typing a
one-time code, which the identity spec already forbids and which no admin is
ever shown a code to fill. And because the root resolves the session and then
redirects into a shell that resolves it again from scratch, one cold launch asks
who you are twice.

## What Changes

- **The root stops greeting and starts resolving.** It renders no words of its
  own. A session still resolving shows the app-boot placeholder; a resolved one
  goes to that person's own shell; a confirmed signed-out one goes to sign-in;
  and a session that could not be confirmed says so and offers a retry, exactly
  as a role shell already does.
- **A session that is not yet known is never treated as signed out.** Only a
  confirmed absence of a session reaches sign-in. An unreachable network leaves
  somebody looking at a retry, never at a password field for a session they
  already hold.
- **Sign-in becomes the app's front door** and is composed like one, centred the
  way the app's other standalone cards already are.
- **Typing a one-time code stops being offered.** `/activate` acts on the code
  in the link it was opened with. Opened without one, it says the link is
  incomplete and offers the way to sign in. The route into it from sign-in goes
  with it, and the sentence that remains covers a first activation as well as a
  forgotten password.
- **The real session is resolved once per visit, not once per screen.** It moves
  into a provider covering the signed-in and public branches, leaving demo mode
  outside it, so the root and the shell it hands off to share one answer. Signing
  in benefits by the same mechanism: the provider is already listening, so the
  destination arrives knowing who it is serving.

## Non-goals

- **Leaving demo mode is unchanged.** Its exit still returns to the application
  root, and a signed-out visitor arriving there now reaching sign-in is
  acceptable: the exit serves the owner, and the prospect a demo link was sent
  to has no reason to use it.
- **Offline cold start is not addressed.** A signed-in person with no network
  resolves to "could not confirm" because the profile read needs the network.
  Role shells already behave this way; the root's card was only hiding it at one
  path. Making the app open offline from a cold start is its own change.
- No change to what a session *is*, how it is derived from assignments, how
  deactivation ends one, or how long one lives.
- No self-service password recovery, and no new route by which somebody can
  reach a code or a link without an admin issuing it.
- No redesign of the sign-in or activation forms beyond removing the code field
  and centring the card. Field names, autocomplete semantics, and the identical
  refusal for an unknown identifier and a wrong password all stand.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `identity-and-access`: the application root becomes a resolver with defined
  behaviour in all four session states, including that an unconfirmed session is
  never sent to sign-in, and activation no longer accepts a typed code as an
  entry path.
- `demo-mode`: wording only. The requirement that the demo is not advertised
  publicly names "the public landing page", a screen that will no longer exist.
  The behaviour it requires is unchanged and stays true of the screen that
  replaces it.

## Impact

- **UI:** the root route, the sign-in screen's card and its activation link, the
  activation screen's code-entry state, and a shared app-boot placeholder now
  used by both the root and the role shells.
- **Routing:** a pathless layout route wrapping the public and role branches with
  a real-session provider, with demo mode deliberately left as a sibling outside
  it. Path ranking is unaffected because a pathless route contributes no segment.
- **Session:** `revalidate` and `endSession` are read from context rather than
  returned to each consumer. The hook that computes session state is unchanged.
- **Demo seam:** the provider must not mount above `/demo`. The demo-scope
  tripwire is the check that this holds.
- **Verification:** component tests for all four root states, the removed
  code-entry path, and the single-resolution guarantee; the E2E suites that
  currently assert the root's card, the sign-in link they reach it by, and the
  demo exit's destination; the offline gate, which primes at the root; both
  themes and viewports; and every ordinary CI gate.
- **Durable documentation before archive:** `docs/SCREENS.md` (the root's four
  states, which it does not document today, and the sentence promising that
  somebody handed only a code can type it) and `docs/DEMO_MODE.md` (two mentions
  of the landing page).
