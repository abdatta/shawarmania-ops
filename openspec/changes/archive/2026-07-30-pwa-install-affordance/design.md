## Context

The manifest, icons, service worker and standalone launch behavior already
make Shawarmania Ops technically installable. Discovery is left entirely to
browser chrome, while the product is used from two device contexts whose own
shell headers are always visible: personal phones and a counter tablet.

The application has three route branches. Public pages use `RootLayout`, real
role routes mount `PhoneShell` or `CounterShell` through `RealRoot`, and demo
routes mount those same shells through `DemoRoot`. A deferred browser install
event is single-use and can be lost if the component that captured it unmounts,
so the route split matters to state ownership.

This is global PWA chrome rather than a business-data surface. It does not use
an adapter, change a feature gate, contact Supabase or alter offline billing.

## Goals / Non-Goals

**Goals:**

- Make installation discoverable exactly when the current device has a
  working native or documented manual path.
- Preserve a captured native prompt across public-to-real route transitions.
- Put the action in persistent public and real shell chrome without crowding
  phone or counter layouts.
- Match Shawarmania's semantic tokens, control sizes, focus treatment and
  light/dark behavior.
- Keep the action understandable on touch devices and stable for people who
  prefer reduced motion.

**Non-Goals:**

- Change PWA installability, the manifest, service-worker lifecycle or offline
  cache behavior.
- Promote installation in demo mode.
- Add data adapters, RLS policies, money arithmetic, analytics, device
  enrolment or browser fingerprinting beyond the platform checks required for
  the iOS manual path.

## Decisions

### D1 — Capture installation capability above the router

An `InstallPromptProvider` mounts around `RouterProvider` in `main.tsx`. It
owns the deferred `beforeinstallprompt` event, installed-state detection and
the `appinstalled` listener. Header buttons consume a small context containing
the current mode and a request function.

This keeps one event listener alive while `RootLayout`, authentication screens
and real role shells replace one another. It also gives the native event one
owner, so two visible actions can never race to consume it.

**Rejected:** let each `InstallAppButton` listen for the event, as Todoay does.
That is sufficient for a simpler page tree, but Shawarmania can unmount the
public branch during sign-in and discard the only prompt event.

**Rejected:** keep the deferred event in a module global. That would survive
route changes but creates mutable state outside React with no subscription
contract and complicates deterministic tests.

### D2 — Render only when installation is actionable

The provider exposes:

- `native` after `beforeinstallprompt` has fired and been prevented;
- `ios` for an uninstalled iPhone or iPad running Safari in browser mode;
- `null` everywhere else.

Standalone and fullscreen display modes and iOS `navigator.standalone` mark the
app installed. `appinstalled` clears any native prompt immediately. Calling
the native request consumes the deferred event in a `finally` path after the
browser choice, because the platform does not allow it to be reused.

Unsupported browsers and Chromium contexts that have not emitted
`beforeinstallprompt` render no action. A visible control that cannot install
would be a lie.

**Rejected:** always show an Install button and explain failures after a tap.
The app cannot manufacture a native prompt when the browser has not provided
one.

### D3 — Public and real shells opt in; demo shells do not

`RootLayout` renders the action before its theme toggle. `RealRoot` passes the
action through a new optional shell slot; the phone shell renders it before
theme and account, and the counter shell renders it after sync status and
before theme and account. `DemoRoot` leaves the slot empty.

This preserves the shells' mode-agnostic slot pattern and avoids inviting a
demo recipient to install from `/demo` only to have the manifest's root
`start_url` open at sign-in later.

**Rejected:** hard-code the button inside both shared shells. That would make
demo installation an accidental consequence of component reuse.

**Rejected:** put installation in the account menu, bottom navigation or
individual page headers. The public flow and demo have no account menu, install
is not a route, and page headers are not present on every counter surface.

### D4 — Reuse the semantic primary control, not Todoay's visual skin

The collapsed action is a 44 px existing phone-sized primary control with an
18 px download icon and the accessible name “Install Shawarmania Ops as an
app”. It expands just far enough to show the label “Install”, using the normal
rounded rectangle, `primary`, `on-primary` and focus-ring tokens. It contains
no raw color and adds no gradient or ornamental shadow.

When capability first appears in a tab, the label expands after three seconds,
stays visible for five seconds and collapses. Hover and keyboard focus reveal
it again. A session-storage marker prevents the timed lesson from replaying
on every route or reload in that tab. Under `prefers-reduced-motion: reduce`,
the full label stays visible without a width transition until the action is
used or installation ceases to be available.

The counter header deliberately uses the same 44 px chrome control as its
existing theme and account actions rather than introducing a mismatched 48 px
button into the fixed header.

**Rejected:** copy Todoay's gradient pill and glow. Those belong to Todoay's
visual system; Shawarmania components consume semantic tokens and its ops
portal explicitly avoids decorative marketing treatments.

### D5 — iOS uses an in-app instruction popover

On iOS Safari the action toggles a right-aligned status popover:
“In Safari, tap Share, then Add to Home Screen. Turn on Open as Web App, then
tap Add.”

The popover uses the semantic surface, border and content tokens. It stays
attached to the header action and does not imitate a browser-owned prompt.
Opening the installed app later is what removes the action through
`navigator.standalone`.

**Rejected:** show the Safari instructions in Chrome, Edge or Firefox on iOS.
Those browsers cannot complete the documented Safari path from their current
page, and an “Install” action there would not perform its named action.

## Risks / Trade-offs

- **[The browser may fire `beforeinstallprompt` after an arbitrary delay]** →
  render nothing until it fires; tests dispatch the event explicitly.
- **[The prompt can be consumed only once]** → clear it after every outcome and
  wait for a new platform event before showing the action again.
- **[Header expansion can crowd the counter]** → remain 44 px at rest, reveal
  only once, and verify the smallest supported phone and landscape tablet.
- **[User-agent checks age poorly]** → confine them to the Safari-only fallback;
  native-capable browsers are driven solely by their event.
- **[Session storage may be unavailable]** → treat the reveal marker as a
  progressive enhancement and keep the action otherwise functional.
- **[Shell changes can disturb authenticated role landings]** → run the real
  four-role auth E2E suite in addition to ordinary component and demo tests.
- **[No RLS, money or offline semantics are touched]** → database suites are
  not required by scope; the ordinary offline-shell E2E remains part of the
  full browser gate.

## Migration Plan

Ship the provider and action with the existing static bundle. No stored data,
manifest or service-worker migration is required. Existing installed clients
continue to hide the action; browser users see it only after eligibility is
reported.

Rollback removes the provider, shell slots and tests. It does not require
cache, database or device cleanup.

## Open Questions

None. The exploration settled placement, demo omission, styling, native
behavior, iOS instructions and reduced-motion treatment before proposal.
