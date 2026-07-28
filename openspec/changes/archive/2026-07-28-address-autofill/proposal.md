# Proposal: address-autofill

> **Model**: Opus · **Wave**: B · **Depends on**: #15 · **Gate**: **an owner creating an outlet picks their shop from a search and every address field fills in one action — District included, from the PIN rather than guessed; every field stays editable; the form works exactly as it does today when the lookup is unreachable; the geofence is untouched.**

## Why

The outlet form's address block is five empty boxes marked *(optional)*, and
optional fields on a form somebody fills once get skipped. That is fine until it
is not: a GST invoice legally carries the supplier's address, so
[`todos/bill-gst-breakup.md`](../../todos/bill-gst-breakup.md) inherits whatever
was typed here — or was not. The cheapest moment to get an outlet's address
right is the moment the outlet is created, and right now that moment asks for
five separate acts of typing on a phone.

There is also a field nobody can reliably answer from memory. **District** is an
Indian revenue district — Nadia for Kalyani, North 24 Parganas for Kanchrapara —
and it is the one part of the address an owner is most likely to leave blank or
fill with the town's name instead.

## Scope

**A search above the address block.** Type a landmark, a street or a shop name;
pick a suggestion; line 1, line 2, city and PIN code fill in one action. The
location label fills too, but only when it is still empty — never overwriting
something already written.

**District comes from the PIN, not from the map.** Probed against real data
before committing to this design: OSM's `district` is a ward or sector (`B-7`
for Central Park, Kalyani; `F/N Ward` in Mumbai) and its `county` is
inconsistent (`Kalyani`, `Barrackpur - I`, `Mumbai City District`) — neither is
the revenue district. India Post's public PIN directory answers `741235` with
**Nadia**, authoritatively. So the fill is two hops, and the second one is
useful on its own: **typing a PIN by hand fills District without touching the
search box at all.**

**Two keyless, free, account-free sources.** Photon (Komoot's OSM geocoder,
built for as-you-type) and `api.postalpincode.in`. No Google Cloud project, no
billing, no API key, nothing for the owner to provision or restrict. Nominatim
is deliberately not used: its usage policy forbids autocomplete.

**A reusable component behind the adapter seam.** `PlacesAdapter` with a real
implementation and a mock, so demo mode keeps its guarantee that no request
leaves the app's own origin, and so the employee address field can adopt the
same picker later with no rework.

**Everything stays typeable.** The fill is a draft: every field remains editable
afterwards, and an owner who ignores the search entirely gets exactly the form
they have today. A lookup that is slow, refused, rate-limited or offline is
silent — it never blocks creating an outlet, and it never surfaces an error over
an optional convenience.

## Out of scope

**The geofence.** The coordinates that come back with a suggestion are
discarded, never stored. `outlets.latitude/longitude` is read directly by the
check-in trigger, so a map-search coordinate would silently arm the fence
against a rooftop centroid — and mark somebody absent while they stand at their
own counter. **Capture position here**, on site, stays the only thing that
surveys an outlet (#5 design D4). This change must not add a second way.

**The employee address field.** The component is built to be reused there;
wiring it in is a later change.

**Google Places.** A better POI index and a worse fit: an account, billing, a
key to restrict, and a required attribution, in exchange for precision this
change explicitly does not need. If OSM coverage disappoints in practice it
becomes a second adapter implementation, not a rewrite.

**A map.** No tiles, no pin-dragging, no visual picker.

## Risks

**Two third parties the app did not previously depend on.** Both are consulted
only while an admin types their own shop's address — never with customer or
employee data — and both are optional to the operation in progress. Recorded in
`docs/SECURITY_AND_PRIVACY.md` rather than left implicit.

**A free public instance can disappear or throttle.** Which is why failure is
silent and the manual path is untouched: the worst outcome is the form somebody
already has.

**A picked address can still be wrong.** OSM data is contributed, not surveyed.
The fill being editable is the mitigation, and the owner is looking at their own
shop's address at the moment they pick it.
