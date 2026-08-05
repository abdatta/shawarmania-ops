# Design: One Outlet Scope Above Both Attendance Axes

This change exists mostly to move three controls around, and `design.md` would
normally be skipped for that. It is here for one paragraph: it reverses a
recorded decision, and a later reader finding the reversal with no note would
have to reconstruct why — or worse, would read it as the decision having been
forgotten.

## D1. The outlet selection scopes the surface, not the by-outlet axis

**`attendance-one-day-per-person` decided the opposite (its design D4), and this
supersedes it.**

That decision was made against a real confusion. Before it, the outlet came
first and the axis second, which made "how many days did this person work in
August" impossible to ask without first naming one shop. Splitting the axes
fixed that, and the fix was defended by cutting the outlet choice out of the
by-staff axis entirely — so that deselecting a shop above could not empty a
picker that has nothing to do with shops.

The half being reversed is the second one. The first still holds and is what
makes the reversal safe:

- **The read is unchanged.** `listPersonRange` names a person and two dates and
  no outlet, exactly as D4 required. What comes back is still resolved in the
  database from the reader's own live assignments. The narrowing here is a
  filter on a list of names in a `<select>`, applied after the policies have
  already decided what the reader may see. It widens nothing and it is not a
  boundary.
- **A person's month is unchanged.** `assembleRange` still receives every outlet
  the reader may see and every assignment window the person holds, so somebody
  who moved from Kalyani to Kanchrapara in the middle of August still gets one
  continuous August. Narrowing *that* is what would break the axis's whole
  question, and it is explicitly out of scope.

What is left of D4's worry is real but smaller than it was: a two-outlet owner
looking at Kalyani will not find a Kanchrapara-only person in the picker until
they select Kanchrapara. Against that:

- The chips are now in the header, visible on the axis, and toggling one is a
  single tap. The person who has "gone missing" is one tap from being back.
- The alternative the owner rejected — chips that sit above the tabs and do
  nothing on one of them — is a worse version of the same confusion. A control
  that is visible and inert teaches the reader that controls lie.
- The empty case already reads correctly: `StaffAxis` renders "Nobody is on
  these outlets' staff lists yet" when the narrowed list is empty, which is a
  true sentence about the selection.

## D2. A selected person who leaves the narrowed list is replaced, not kept

Narrowing a list under a `<select>` whose value points outside it is how a
surface ends up reading a person it is not showing. The chosen person is
therefore validated against the narrowed list on every render and falls back to
its first entry — derived, not seeded from an effect, matching how `StaffAxis`
already derives its default.

Deliberately **not** keyed on the selection: the month stays where the reader
put it when they toggle a shop, because the month is a fact about what they are
reading and not about which shops are on.

## D3. Segmented control rather than `role="tablist"`

The axis buttons carried `role="tab"` and `aria-selected` with no `tabpanel` and
no `aria-controls` beneath them, which is a tablist that is not one. The Ledger's
idiom — `role="group"` plus `aria-pressed` on two buttons — is both the shape
being matched and the honest description of what these are. Adopting it costs
one test id rename (`axis-outlet` → `axis-day`, referenced nowhere but the
component) and buys one idiom across two surfaces instead of two.
