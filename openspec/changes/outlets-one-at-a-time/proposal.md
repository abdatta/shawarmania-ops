# Proposal: outlets-one-at-a-time

> **Model**: Opus · **Roadmap**: deliberately unlisted. This narrows a shipped
> surface rather than sequencing new capability, so it gets a change folder and
> no row, like `tablets-one-outlet-at-a-time`. · **Gate**: Outlets lists every
> outlet the reader may see, and each row opens that outlet's own page, which
> holds everything about it: its details and its tablets. Back returns where the
> reader came from, or to the list when the page was the first one opened. Every
> action the outlet card and the Tablets page had is still there: add, edit,
> capture, close, reopen, delete, and set up, edit and remove a tablet. The
> Tablets page and its addresses are gone. The owner settled the layout in the
> demo before any of it reached production, and the four-role demo walkthrough
> still walks.

## Why

The owner asked for it on 2026-09-26, and it is also the ground the next change
needs.

**Outlets is a list of cards, one per outlet.** That was the right shape when
the only question was *which shop and where is it*. The owner now wants each
outlet to carry its own **settings**. The first of them is how the outlet
serves: dine-in, takeaway, tables and packaging, in
`each-outlet-chooses-how-it-serves`. A settings page with every outlet stacked on
it reads as one long form in which it is never clear which shop a switch
belongs to. One outlet at a time is the only shape where "this switch is for
this shop" is obvious without a sentence saying so.

**The page it replaces will be read by a newcomer.** The owner's framing: an
outlet setting itself up should see a short, simple page, and the page should
grow only as the outlet switches things on. That rule belongs to the settings
change. This change makes a page that can grow that way: one outlet, its basics,
and room underneath.

**Nothing is lost by stopping the side-by-side view.**

- The business is converging on a single outlet, *Kalyani Cafe*, from about
  October 2026, for six to twelve months, so for the foreseeable future the list
  is one row and the page is that one outlet.
- The cross-business question the stacked cards used to answer at a glance
  (*is every shop all right?*) is already answered on **Overview**. Every outlet
  there carries its tablet status, linked to that outlet's page.
- `tablets-one-outlet-at-a-time` made the same move on 2026-09-21 and leaned on
  this surface's cards for the cross-business health view. That reason has since
  moved to Overview, so nothing is left without a home.

## What changes

**Outlets is a list, like Team, and each row opens that outlet's own page**
(owner, 2026-09-26, after four rounds recorded in `design.md`). A row says the
outlet's name, short code and area, whether it is open, and its tablets in one
line (how many, and how many bills are unsent or tablets are out of touch).
**Add outlet** is on the list, and a new outlet opens on its page. The owner's
list includes closed outlets, after the trading ones. With one outlet the list
is still shown: skipping it would make Back bounce.

**The outlet's page (`outlets/:outletId`) has no picker.** Its **Back** steps
back through the reader's own history, so a reader from Overview returns to
Overview. When the page was the first one the app opened, Back goes to the list.

**On that page, the outlet's name heads everything about it**
(owner, 2026-09-26; the rounds are recorded in `design.md`):

- **The head** is the outlet's name, its short code under it, and its status
  as plain words (Open, or Closed in red), with no dot.
  No outline encloses the rest: nothing on the page sits outside the outlet.
- **Details** is a card of tiles, each a caption over a value: location and
  phone side by side, the address, when the day ends and when staff check in,
  and the check-in fence. A clear **Edit** button sits on its label. Edit
  changes exactly what the card shows, plus the name and short code. The fence has its own **Recapture** button, because a
  position can only be captured standing at the counter.
- **Tablets** is a section under the same outlet, not a page of its own: *Tablets ·
  2*, with Re-read and **Set up** on its label, then each tablet's card. A
  tablet's card says in three short lines, each with an icon, what used to take
  two sentences: whether it is in touch, what it has not sent, and who is on it.
  Its buttons read **Edit** (top right) and **Remove** (bottom right, in red),
  because the card already names the tablet.
- **Mark closed** is one small red-outlined button, centred at the page's foot. A closed outlet
  shows **Reopen** and **Delete outlet** there instead.
- The later settings (dine-in, takeaway, packaging) become more labelled
  sections under the outlet's name.
- **Add outlet** stays in the page header, and the page title stays *Outlets*.

**The Tablets page is gone.** It was the one page in the app that behaved like a
navigation tab without having one. A tablet belongs to exactly one outlet, and a
manager had the Outlets page at all only so they could reach their tablets (#51).
Its routes (`devices`, `devices/:outletId`) and its two gate entries are removed
rather than redirected: nobody holds a saved link to either (owner,
2026-09-26). Overview's status link now opens the outlet's page.

**A closed outlet is still reachable**, for the owner, from the foot of the
list. Its page says it is closed and offers Reopen and Delete outlet. It shows no
tablets, because a closed outlet has no counter to administer. Deleting it
returns to the list.

**A manager sees the same list and pages** over the outlets their assignments
name, with no Add, Edit, Recapture or closing actions. They keep every tablet
action they had, which is the reason they have this surface at all.

**Open and Closed mean one thing everywhere.** On Outlets they say whether a
shop is trading, as plain words in a Status column like Team's, with no dot.
Overview's per-outlet status, a live reading of the tablets, now reads
**Online** (green, or yellow when only some tablets are reachable) or
**Offline** (red) instead of Open and Closed.

## Non-goals

- **No new settings.** Dine-in, takeaway, tables and packaging are
  `each-outlet-chooses-how-it-serves`. This change leaves room for them and
  builds none.
- No change to what an outlet row holds, to who may write it, or to any policy.
  No migration.
- No change to the edit form, the capture flow, the setup-code, edit, move and
  remove flows for a tablet, or the close and delete rules. Their dialogs,
  sheets and wording are unchanged; only where they are reached from moves.
- No cross-outlet summary on the list beyond one line of tablets. Overview is
  the cross-outlet view.

## Docs to update before archiving

- `docs/SCREENS.md`: the Outlets entry describes the list and the outlet's page.
- `docs/OPERATIONS.md`: the onboarding runbook's steps say where each thing is
  on the new page.
- `docs/DEMO_MODE.md`: the walkthrough's Outlets and Tablets steps.
- `docs/SCREENS.md` (Overview entry) and `docs/GLOSSARY.md`: Online and Offline
  for the tablets, Open and Closed for the outlet.
- `docs/OFFLINE_AND_SYNC.md` and `docs/ROLES_AND_PERMISSIONS.md`: wherever they
  send a reader to the Tablets page, they send them to the outlet's page.
