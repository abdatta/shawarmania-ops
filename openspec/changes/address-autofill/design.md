# Design: address-autofill

> **Model**: Opus · **Wave**: B · **Depends on**: #15

## Context

The outlet form's address block (`outlets-surface.tsx`) is five inputs — line 1,
line 2, city, district, PIN — under a single *(optional)* label. `NewOutlet`
already carries all five as nullable columns, so nothing about the data model
changes here; what changes is how they get filled.

Two facts shaped every decision below, and both were **probed against live
responses before being written down** rather than assumed:

- **Photon (Komoot's OSM geocoder) covers Kalyani and Kanchrapara well** and
  returns a PIN code more often than expected — `741235` for Central Park,
  `743145` for Kanchrapara Station Road.
- **No OSM field is the Indian revenue district.** Photon's `district` is a ward
  or sector (`B-7` in Kalyani, `F/N Ward` in Mumbai) and its `county` is
  inconsistent (`Kalyani`, `Barrackpur - I`, `Mumbai City District`). India
  Post's public PIN directory answers `741235` with **Nadia**.

## Goals / Non-Goals

**Goals:**

- One action fills line 1, line 2, city and PIN; District follows from the PIN.
- District fills for somebody who types a PIN and never opens the search.
- Nothing to provision: no account, no key, no billing, no attribution clause.
- The form behaves exactly as it does today when the lookup is unreachable.
- A component the employee address field can adopt later with no rework.

**Non-Goals:**

- **The geofence.** Coordinates are discarded (D3).
- A map, tiles, or a draggable pin.
- Wiring the picker into the employee form — later change.
- Google Places — a later adapter if OSM coverage disappoints, not a rewrite.

## Decisions

### D1 — Photon, and specifically not Nominatim

Nominatim's usage policy **forbids autocomplete outright**, so the obvious OSM
endpoint is disqualified on its terms of use rather than on its behaviour.
Photon exists for exactly this, is keyless, and sends `Access-Control-Allow-
Origin: *`.

*Rejected: Google Places.* A better POI index, in exchange for a Cloud project,
enabled billing, a key to restrict, and a mandatory "Powered by Google". The
precision it buys — rooftop coordinates, exact business listings — is precisely
what this change does not use, because the fence is captured on site and the
address is a record rather than a locator.

Provider choice lives behind the seam, so the swap is one implementation.

### D2 — Called straight from the browser, with no Edge Function proxy

There is nothing to protect. No key, no token, no quota tied to an identity — a
proxy would add a round trip through Supabase on every keystroke, another
function to deploy and version, and would make a public lookup fail whenever our
own backend is down.

The one thing a proxy would buy is hiding the admin's IP from Komoot. That is
worth less than the simplicity here: it is an owner typing their own shop's
address a handful of times, not customer or employee data. Recorded in
`docs/SECURITY_AND_PRIVACY.md` rather than left implicit.

### D3 — Coordinates are not merely ignored, they are unrepresentable

`outlets.latitude/longitude` is read directly by the check-in trigger. A
map-search coordinate written there would arm the fence against a rooftop
centroid and mark somebody absent standing at their own counter — which is why
#5 design D4 has no field for typing coordinates in the first place.

So `AddressSuggestion` **has no latitude or longitude field at all.** The
adapter drops them at the boundary. A comment saying "don't use these" survives
exactly until somebody needs them; a type that cannot carry them does not.

### D4 — District comes from the PIN, and that is a feature rather than a workaround

| Query | Photon `city` | Photon `postcode` | Photon `district` | India Post from PIN |
|---|---|---|---|---|
| Central Park Kalyani | Kalyani | 741235 | `B-7` | **Nadia** |
| Kanchrapara Station | Kanchrapara | 743145 | *absent* | **North 24 Parganas** |
| Ghoshpara Road Kalyani | Kalyani | 741235 | *absent* | **Nadia** |

Two hops rather than one, and the second hop is independently useful:
**`districtForPincode` runs when the PIN field is edited by hand too**, so
somebody who ignores the search entirely still gets the field they were least
able to answer.

*Rejected: mapping `county` to District.* It would put "Kalyani" in the District
box — confidently, and wrong, which is worse than empty.

### D5 — Picking replaces the whole address block; the label is only ever filled when blank

A pick is an explicit act with an obvious intent, so it writes all four address
fields including clearing ones the suggestion does not carry. The alternative —
merging into whatever is there — produces a street from one place with a PIN
from another, which is the one failure mode nobody would notice.

The **location label** is treated differently, because it is the owner's own
words rather than an address component: it is filled only when empty, and never
overwritten.

### D6 — The second hop never blocks the first

Picking fills four fields immediately and returns. District arrives when the PIN
lookup answers, or never. No spinner over the form, no disabled Save, no waiting.

### D7 — Failure is silent, but "nothing found" is an answer

A refused, slow, throttled or offline lookup produces no error text: this is an
optional convenience on an optional block, and an error banner would imply
something needs fixing when nothing does.

"No matches" is different — it is a real answer to a real question, and without
it somebody sits watching an empty list. So zero results says so, and points at
the fields below.

### D8 — Debounced and abortable, so a stale answer cannot win

300 ms debounce; every request carries an `AbortSignal` and the previous one is
aborted. Without the abort, a slow response to `ka` can land after a fast
response to `kalyani` and replace the better list with the worse one.

### D9 — A real combobox, not a div with a click handler

ARIA 1.2 combobox: `role="combobox"` with `aria-expanded`, `aria-controls` and
`aria-activedescendant` on the input; `role="listbox"` and `role="option"` on
the list. Arrow keys move, Enter picks, Escape closes. Options carry a phone-
sized touch target, because this form is filled on a phone.

### D10 — India-restricted queries

Photon takes a `bbox`, which restricts rather than biases. Without it, "Central
Park" returns New York. With `68.1,6.5,97.4,35.7` every probe returned Indian
results.

### D11 — The demo gets canned suggestions, and that is what keeps its guarantee

`demo-mode` promises no request leaves the app origin, and it is asserted in the
E2E suite. The mock adapter resolves from a small fixture — including one place
with no PIN, so the demo shows what a partial fill looks like rather than only
the happy one.

## Risks / Trade-offs

**Two third parties where there were none.** → Both keyless, both free, both
consulted only with an outlet's own address, both optional to the operation in
progress. The manual path is untouched, so the failure mode is today's form.

**A free public instance can throttle or vanish.** → D7 makes that indistinguishable
from "no matches", which is survivable. If it becomes chronic, the seam means a
self-hosted Photon or a Google adapter is one implementation.

**OSM data is contributed, not surveyed.** → The fill is editable and the owner
is looking at their own shop's address as they pick it.

**`api.postalpincode.in` is a community service with no SLA.** → Same treatment:
District simply does not fill, and it is a field they can type.

## Migration Plan

None. No migration, no schema change, no Edge Function, no environment
variable — this is client code and a test suite. It ships with the ordinary
`main` push.
