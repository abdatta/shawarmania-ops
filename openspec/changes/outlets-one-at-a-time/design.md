# Design: outlets-one-at-a-time

The name is the change's first framing: one outlet at a time behind a picker.
Where it landed, after five rounds with the owner at the checkpoint, is a list of
outlets where each row opens that outlet's own page. The name still fits the
page, which is about one outlet and nothing else. The rounds are recorded at the
end so nobody rebuilds a shape the owner already turned down.

## Context

Before this change, `src/features/outlets/outlets-surface.tsx` drew every outlet
the reader may see as a card: identity, a *what this outlet is raising* block
(#51), the tablet's state, and the owner's actions (edit, capture, tablets,
close, reopen, delete). Tablets were administered on a separate page,
`devices/:outletId`, reached only through the Tablets button on an outlet's card.
It was the one page in the app that behaved like a navigation tab without having
one.

Both `owner-outlets` and `admin-outlets` in `src/gates/registry.ts` route to the
same surface, which offers a manager fewer controls. The database refuses every
write that is not the owner's (`outlets_insert`, `outlets_update`,
`outlets_delete`), and that is the boundary. The controls are only a courtesy.

Overview's per-outlet status read **Open / Closed** from the tablets'
heartbeats, while Outlets used the same two words for whether a shop is trading.

## The settled layout (owner, 2026-09-26)

Phone width.

```
Outlets                                            [+ Add]
┌──────────────────────────────────────────────────────┐
│ OUTLET                       TABLETS      STATUS       │
│ Shawarmania Kalyani          2            Open      >  │
│ kalyani · Kalyani — Central  1 unsent                  │
│ Shawarmania Kanchrapara      1            Open      >  │
│ kanchrapara · Kanchrapara    3 unsent                  │
│ Test outlet (created by …)   —            Closed    >  │  ← owner only, last
└──────────────────────────────────────────────────────┘

   tap a row ↓

(←) Shawarmania Kalyani                             Open
    kalyani

Details                                         [✎ Edit]
┌──────────────────────────────────────────────────────┐
│ ┌ 🏷 Location ──────────┐ ┌ ☎ Phone ────────────────┐ │
│ │ Kalyani — Central Park│ │ +91 89815 24778         │ │
│ └───────────────────────┘ └─────────────────────────┘ │
│ ┌ ⌖ Address ──────────────────────────────────────┐   │
│ │ Ward 10, B-9 Diagonal Road, … Kalyani, 741235     │   │
│ └──────────────────────────────────────────────────┘   │
│ ┌ ☾ Day ends ───────────┐ ┌ ◷ Staff check in by ─────┐ │
│ │ 04:00                 │ │ 13:00                     │ │
│ └───────────────────────┘ └──────────────────────────┘ │
│ ┌ ◎ Check-in fence ──────────────────────────────────┐ │
│ │ 150 m · ±9 m                        [⌖ Recapture]  │ │
│ └────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────┘

Tablets · 2                                [↻] [+ Set up]
┌──────────────────────────────────────────────────────┐
│ Counter tablet                               [✎ Edit] │
│ ᯤ Seen 07:31 am                                       │
│ ⇪ 1 unsent · oldest 07:27 am                          │
│ ☺ Demo Biller · since 11:00 am             [🗑 Remove] │
└──────────────────────────────────────────────────────┘

  (dine-in and packaging sections join here, between
   Details and Tablets, in each-outlet-chooses-how-it-serves)

                     [Mark closed]
```

A closed outlet shows no Tablets section, and **Reopen** and **Delete outlet** at
its foot instead of Mark closed. A manager's list and pages are the same without
*Add*, *Edit*, *Recapture* and the closing actions; they keep every tablet
action, and their list holds no closed outlet.

## Decisions

### D1. A list, and a page per outlet

Settled in round 4, replacing the chip picker of rounds 1 to 3. The owner asked
for Team's shape: a list where each row opens that item's own page.

- **Why it beat the picker.** The chips wrapped onto two lines at three outlets
  and would only get worse as franchises open. A closed outlet was a chip marked
  *· closed*; in a list it is a row at the foot. A page about one outlet needs no
  control for choosing one.
- **The list stays light.** A row is the name, the short code and location
  label, a **Status**, and one line about its tablets: how many, then how many
  bills are unsent or, failing that, how many tablets are out of touch (*None*
  in amber when there is no tablet, *—* for a closed outlet, *Not read* when the
  tablet read fails, never a claim of none). Overview is the per-outlet summary,
  and this must not become a second one.
- **Each row is one link.** `DataTable` gained an optional `rowClassName`, so a
  row can be `relative`, and the name cell's link is stretched over the whole
  row: one tap target, and still one link, named for the outlet, to a screen
  reader. The chevron has its own narrow column.
- **Closed outlets come last**, for the owner only. A manager cannot reopen one,
  so a closed shop on their list would be a row with nothing to do about it.
- **One outlet is still a list.** With only Kalyani Cafe for six to twelve months
  that costs one tap a visit. Skipping the list when there is one outlet was
  rejected: Back would land on a list that bounces straight forward again.
- **The shared picker is untouched.** Round 1 gave `useOutletScope` an option for
  a surface to supply its own outlets, so the page could offer a closed one. The
  list made that unnecessary and the option was removed:
  `src/features/outlet-scope.tsx` is exactly as it was.

### D2. The outlet's page, and every group of its things under its name

The owner's test, after round 2: *the tablets are under that outlet*, so nothing
about an outlet may read as standing beside it. The outlet's name is the page's
title, its short code under it, and its Status on the right. Every group
(Details, Tablets, and later the service settings) sits under it, each under a
small, quiet label that carries that group's buttons on the right
(`OutletSection`, `src/features/outlets/outlet-section.tsx`). The label is
deliberately quieter than the outlet's name: a group heading as loud as the name
is what made Tablets read as a sibling of the outlet in round 2.

No outline encloses the groups. One was built in round 3 and removed at the
owner's word: nothing on the page sits outside the outlet, so the outline
enclosed the whole page and said nothing.

**Icons are coloured one way throughout the page**: the accent colour for what a
line is about, green or amber only where the icon itself reports a state (a
tablet in touch or not, bills sent or not, a fence captured or not).

### D3. Tiles, and buttons that say only the verb

The owner turned down sentences and one-fact rows alike: *less text, better UI*.

- **Details is tiles**, each a caption over a value, in one grid: location label
  and phone side by side, the address across the row, *Day ends* and *Staff
  check in by* side by side, and the check-in fence. **Edit** is a real button on
  the Details label. It changes exactly what the card shows, plus the name and
  short code in the title, so it needs no caption saying what it opens.
- **The check-in fence is a tile of its own, with its Recapture button inside
  it**, and the button carries an icon. The position is not in the edit form,
  because it can only be captured standing at the counter. In round 3 the owner
  could not tell a bare *Recapture* at the card's far edge was a button, or which
  value it belonged to. Uncaptured, the tile has an amber edge, reads *Not
  captured*, and the button is the primary *Capture*.
- **A tablet's card keeps the Tablets page's card, shortened.** Its two sentences
  became three icon lines: in touch or not, what is unsent, and who is on the
  shift. What the sentence was careful about still holds: these are what the
  tablet **last reported** by its own heartbeat, so a tablet gone quiet leads with
  *Out of touch · last seen …* and the lines under it read as the old figures they
  are. Its buttons run down the card's right edge, which the short lines leave
  empty: **Edit** at the top, **Remove** in a red outline at the bottom. They say
  only the verb, because the card's title names the tablet; the name stays in
  each button's accessible label.
- **Closing is one small red-outlined button, centred at the page's foot**:
  neither a row among routine actions nor a card of its own. A closed outlet
  shows Reopen and Delete outlet there instead, so a trading outlet never offers
  the action that cannot be undone (outlet-deletion, design D3).

### D4. The Tablets page is folded into the outlet's page, and deleted

A tablet belongs to exactly one outlet, and a manager had the Outlets surface at
all only so they could reach their tablets (#51).
`src/features/counter/outlet-tablets.tsx` is that page's body for one outlet: the
same reads, the same setup-code card shown once, and the same edit, move and
remove sheets and confirmations. A closed outlet shows no Tablets section. Who
may administer is unchanged: the owner everywhere, a manager at the outlets they
manage, both decided again by the privileged functions.

`devices`, `devices/:outletId`, `owner-devices` and `admin-devices` are **removed,
not redirected**: nobody holds a saved link to them (owner, 2026-09-26). The one
link inside the app, Overview's outlet status, now opens `outlets/:outletId`.

### D5. A Back that goes back

`outlets/:outletId` is the outlet's page (`OutletPage`). It reads the one row with
`getOutlet`, and an outlet the reader may not see comes back absent under their
policy, exactly as one that does not exist. The page then says *This outlet is
not one you can see* and nothing else.

**Back steps back through the reader's own history** (owner: "should act like a
back button and not hard coded to outlets"). The page is reached from the list,
from Overview's outlet status, and later from the counter, and each reader
returns where they came from. `PageHeader` gained an optional `onBack` for this,
beside its existing fixed `backTo`. When the page was the first entry the app
opened (a reload or a fresh tab; React Router's `location.key` is `default`
there), there is nothing of ours to return to, so Back goes to the list instead
of out of the app.

Adding an outlet from the list opens its new page. Deleting one from its page
returns to the list. The sheets and dialogs that change an outlet (the form,
capture, and the close, reopen and delete confirmations) are written once, in
`useOutletActions`, and used by both the list (add) and the page (the rest).
Their wording and refusals are the card's, unchanged.

### D6. Open and Closed mean the outlet; Online and Offline mean its tablets

Settled in round 5. One outlet could read *Closed* on Overview (its tablet on bad
wifi) and *Open* on Outlets at the same moment.

- **Overview's status reads Online or Offline**, the owner's choice of four
  options: Online with a green dot when every tablet is reachable, Online with a
  yellow dot when some are, Offline with a red dot when none are. The partial
  state is *Online* with a yellow dot rather than a longer label: the owner found
  *Partly online* too long, and a count such as *1/2 online* is what the Overview
  spec refuses. A screen reader hears *Online, some tablets offline*. The domain
  helper `outletPresence` returns `online / partial / offline` to match.
- **Open and Closed mean the outlet's own state, and only that.** They read as
  plain words in a **Status** column drawn exactly as Team draws a person's
  status: the ordinary state in quiet grey, the one that stops things in red
  bold. **No coloured dot**: on this app a dot marks a live reading, and whether a
  shop is in business is a setting somebody chose. The outlet page's title row
  uses the same words and style.
- Rejected: renaming the outlet side to *Deactivated* (Open and Closed would
  have kept meaning two things until every screen changed), mirroring Overview's
  reading in this list (the Tablets column already says it), and dropping the
  status here (Closed would still have meant two things).

### D7. The shimmer is reshaped in the same change

AGENTS.md requires it. The list waits behind table rows, like Team. The outlet's
page waits behind two blocks sized to its Details and its Tablets as measured on
a phone with two tablets (316 and 297 px).

## The rounds the owner walked (2026-09-26)

Each was built and walked in the demo before the next.

1. **A card of rows behind the chip picker.** *THE OUTLET* as a label, a *What
   this outlet is raising* block, then *Name and address → Edit*, *Business day →
   Rolls over 04:00*, *Location → Captured*, *Tablets → 2* as full-width rows, and
   *Mark closed* as a card of its own. Turned down for: too much text, some of it
   redundant; a full row per fact wasting the width; *Edit* not looking like a
   button or saying what it edits; labels where the value itself should show; and
   closing given a whole card.
2. **Cards of sentences**, with the Tablets page's own shape below: the outlet as
   a card of three sentences with a row of buttons, then a *Tablets* heading as
   large as the outlet's name. Turned down for reading as if Tablets were beside
   the outlet rather than under it, and for being text rather than UI. The owner
   also asked here for the Tablets page to be folded in (D4), for the page title
   to stay *Outlets*, and for tablet buttons to say only *Edit* and *Remove*.
3. **One panel per outlet**, a bordered box holding the name, Details and
   Tablets. Liked; then the outline was removed, icons coloured one way, the
   fence given its own tile with Recapture inside, and tablet buttons moved to the
   card's right edge.
4. **A list plus a page per outlet**, replacing the picker (D1). Also: Mark
   closed centred, the short code under the name, Details all tiles with location
   and phone first, and *Staff check in by*.
5. **Open / Closed against Online / Offline** (D6), and a Status column like
   Team's.

## Rejected alternatives

- **Keep the cards and add a settings sheet per card.** The settings would live
  one tap deeper than the outlet, behind a control that is not obviously there,
  and a newcomer would never find them.
- **Keep the chip picker, or a dropdown.** D1.
- **Skip the list when the reader has one outlet.** D1: Back would bounce.
- **Rename the navigation entry or the page title to "Outlet settings".** The
  owner settled it: the title stays *Outlets*.
- **Redirect the old Tablets addresses.** Nobody holds a saved link, so
  redirects would be code kept alive for no reader.
- **A Back hard-coded to the list.** D5.

## RLS, money and offline

None. No table, column, policy or function changes; every refusal the surface
relied on is the database's, unchanged. No money path is touched. The surface is
a personal-device screen, never the counter.
