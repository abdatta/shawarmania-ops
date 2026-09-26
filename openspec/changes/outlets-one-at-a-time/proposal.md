# Proposal: outlets-one-at-a-time

> **Model**: Opus · **Roadmap**: deliberately unlisted. This narrows a shipped
> surface rather than sequencing new capability, so it gets a change folder and
> no row, like `tablets-one-outlet-at-a-time`. · **Gate**: Outlets opens on one
> outlet and shows only that outlet. The picker replaces the choice rather than
> adding to it, and nobody who can see only one outlet is offered a picker. The
> page keeps every action the card had: edit, capture, tablets, close, reopen and
> delete. It still says what the outlet is raising and how its tablet is. The
> address `outlets/:outletId` opens on that outlet. The owner settled the layout
> in the demo before any of it reached production, and the four-role demo
> walkthrough still walks.

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
  October 2026, for six to twelve months. With one outlet the picker is not even
  drawn, so for the foreseeable future this page is the same one outlet whichever
  shape it takes.
- The cross-business question the stacked cards used to answer at a glance
  (*is every shop all right?*) is already answered on **Overview**. Every outlet
  there carries its tablet status, linked to that outlet's Tablets page.
- `tablets-one-outlet-at-a-time` made the same move on 2026-09-21 and leaned on
  this surface's cards for the cross-business health view. That reason has since
  moved to Overview, so nothing is left without a home.

## What changes

**Outlets reads one outlet.** It uses the outlet picker in its single-select
mode, the same chips every other single-outlet surface uses, remembered across
surfaces in the same way. For somebody with one outlet it is not drawn.

**The page is that outlet's settings, in sections that start short:**

- **The outlet**: name, location label and address, with what it is raising and
  how its tablet is, followed by the actions that were on the card as rows. *Name
  and address* opens the existing edit form. *Location* says whether it is
  captured and opens the capture flow. *Tablets* opens that outlet's tablets.
- **Closing and deleting** sit apart, at the bottom, because they are the
  actions a person must not reach by accident. They keep their existing
  confirmation and refusal behaviour exactly.
- **Add outlet** stays where it is for the owner.

**A closed outlet is still reachable**, for the owner, who reopens and deletes
from here. Its chip says it is closed, and its page opens on the reopen action.

**A manager sees the same page, read-only**, over the outlets their assignments
name, as they do today. The tablets row is the reason they have this surface at
all, and it stays exactly as reachable.

**`outlets/:outletId`** opens on that outlet, so another screen can link to one
outlet's settings directly. The next change links to it from the counter.

## Non-goals

- **No new settings.** Dine-in, takeaway, tables and packaging are
  `each-outlet-chooses-how-it-serves`. This change leaves room for them and
  builds none.
- No change to what an outlet row holds, to who may write it, or to any policy.
  No migration.
- No change to the edit form, the capture flow, the tablets surface, or the close
  and delete rules.
- No multi-select mode on this surface. Overview is the cross-outlet view.

## Docs to update before archiving

- `docs/SCREENS.md`: the Outlets entry describes one outlet at a time and the
  page's sections.
- `docs/OPERATIONS.md`: the onboarding runbook's steps say where each thing is
  on the new page.
- `docs/DEMO_MODE.md`: the walkthrough's Outlets step.
