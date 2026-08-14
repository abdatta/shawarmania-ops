## Context

The public root currently offers only personal-account sign-in. An anonymous
installed counter therefore has no in-app route to `/counter/setup`, even
though the setup form correctly rejects a personal session. The tablet
management surface issues a code but cannot navigate a manager's personal
browser to the setup form without sending it straight back to that manager's
shell.

The Counter workspace is a three-column CSS grid: a flexible menu and two fixed
22rem columns. Its archived design deliberately selected equal right-column
widths. The requested change keeps the original anti-reflow rule but replaces
the equality constraint with per-column widths that the counter user can set.

## Goals / Non-Goals

**Goals:**

- Give an anonymous, unconfigured tablet an unambiguous setup route from the
  first screen it reaches.
- Make the current-bill and activity widths independently draggable, with a
  durable local preference and an accessible control for each.
- Preserve the menu's 22rem minimum, all three columns at every width, and
  sideways workspace-only scrolling on narrow viewports.

**Non-Goals:**

- A manager-to-tablet cross-device navigation mechanism, QR payload, or setup
  code in a URL.
- Restoring the hidden standalone Shift tab. The live counter intentionally
  contains that work as a column rather than a second destination.
- Server-side or per-person layout preferences; a counter is shared hardware,
  so the preference belongs to its browser.

## Decisions

### Put the setup entry on the signed-out front door

The Sign in card will include a plain link to `/counter/setup` labelled for a
counter tablet. The issuance card will tell the manager to choose that entry on
the tablet, rather than linking their own authenticated browser to a route that
must redirect it away.

The alternatives are a hand-typed URL and a link on the code card. The former
does not work in an installed PWA; the latter is a broken promise because a
manager's browser is a personal session by design. A QR or remote-handoff
protocol is additional device-to-device capability and stays out of scope.

### Use local, independently sized grid tracks

The workspace will store a pixel width for the current-bill track and one for
the activity track in local storage, defaulting to 22rem. Drag handles at each
track's leading boundary change only that track. The grid retains
`minmax(22rem, 1fr)` for its menu track, so excess requested width increases
the workspace's horizontal scroll width instead of shrinking or hiding menu
tiles.

The handles will use Pointer Events, pointer capture, and keyboard arrow keys.
They will expose a separator name and current/minimum values to assistive
technology. A CSS-only `resize` control was rejected because it cannot size a
grid track reliably or expose a useful keyboard interaction.

### Preserve the existing layout and loading shapes

The columns remain rendered in their original order at every width, and their
existing internal loading regions remain in the same columns. No shimmer shape
changes because no arriving content moves or changes dimension; only a user
actively resizes an already-rendered workspace.

## Risks / Trade-offs

- [A very wide user preference creates more sideways scrolling] → The menu
  cannot fall below its touch-safe minimum, and each resize handle can also
  reduce a column back to that minimum.
- [Local storage can be unavailable or contain invalid data] → Read values
  defensively and fall back to the default without blocking the counter.
- [Pointer-only resizing excludes keyboard users] → Provide focusable separator
  controls and Arrow-key resizing with an announced value.

## Migration Plan

No migration or deployment coordination is required. The release is reversible
by removing the preference-aware tracks; stored browser values then become
unused harmless local data. No billing, offline, setup-code, authentication,
or RLS semantics change.

## Open Questions

None. The user requested drag resizing; browser-local persistence and the
protected menu minimum keep that request compatible with the existing counter
operating model.
