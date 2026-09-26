# Design: outlets-one-at-a-time

## Context

`src/features/outlets/outlets-surface.tsx` renders every outlet the reader may
see as a card. Each card carries the outlet's identity, a *what this outlet is
raising* block (#51), the tablet's state, and the owner's actions: edit, capture,
tablets, close, reopen and delete. Both `owner-outlets` and `admin-outlets` in
`src/gates/registry.ts` route to this one surface, and it offers a manager fewer
controls. The database refuses every write that is not the owner's
(`outlets_insert`, `outlets_update`, `outlets_delete`), and that is the boundary.
The controls are only a courtesy.

`useOutletScope` in `src/features/outlet-scope.tsx` already gives a surface a
remembered, single-select outlet choice. `tablets-one-outlet-at-a-time` moved
Tablets onto it five days before this change.

## The sketch the owner was shown

Phone width. Nothing below the basics exists until the next change adds its
sections.

```
┌──────────────────────────────────────────┐
│ Outlets                    [+ Add outlet] │
│ ( Kalyani Cafe ) ( Kanchrapara · closed ) │  ← only with 2+ outlets
├──────────────────────────────────────────┤
│ THE OUTLET                                │
│ Kalyani Cafe · Kalyani                    │
│ 12 Station Rd, Kalyani 741235             │
│ Nothing raised · Tablet online            │
│                                           │
│ Name and address                Edit  ›   │
│ Location                    Captured  ›   │
│ Tablets                            1  ›   │
├──────────────────────────────────────────┤
│  (the next change's sections go here)     │
├──────────────────────────────────────────┤
│ Close outlet                              │  ← danger text, bottom
│ Delete outlet                             │  ← only when closed
└──────────────────────────────────────────┘
```

A manager's page is the same without *Add outlet*, the *Edit* affordance, the
capture action, and the bottom section.

## Decisions

### D1. The existing single-select picker, and no new control

It is the same chips, remembered the same way, so an owner who picks Kanchrapara
on Attendance lands on Kanchrapara here. It is not drawn for somebody who can see
one outlet. Nothing about the picker's behaviour changes, so every guarantee in
`outlet-scope.tsx` still holds: it is a filter, it is not session state, and it
confers no authority.

**One wrinkle to check, not assume:** this surface shows the owner **closed**
outlets, because they are reopened and deleted from here. Other surfaces may
draw their chips only from trading outlets. If `useOutletScope` does not offer a
closed outlet, this surface passes its own list rather than widening the shared
hook. A closed outlet appearing on Attendance's picker would be a regression
somewhere else.

### D2. Rows, not a card of buttons

Each action becomes a row that states its current answer on the right
(*Captured*, *1 tablet*). That is the answer the card used to give in a
separate line of text. It is also the shape the next change's settings take (a
label, its answer, and a way in), so the page reads as one list rather than two
styles.

### D3. Close and delete go to the bottom, apart

They were buttons among ordinary actions on the card. On a page that is about to
gain switches a person flips casually, the destructive two move out of reach of
a stray tap. Their confirmation dialogs and database refusals are unchanged.

### D4. The address carries the outlet

`outlets/:outletId` opens on that outlet and writes it into the remembered
choice, exactly as `devices/:outletId` does for Tablets. An id the reader cannot
see falls back to their default outlet. It does not show an error, because an id
in an address confers nothing and says nothing about another outlet.

### D5. The shimmer is reshaped in the same change

AGENTS.md requires it. The placeholder becomes one outlet's page (identity block
and three rows) instead of a stack of cards. Otherwise the page loads as cards
and jumps into a page.

## Rejected alternatives

- **Keep the cards and add a settings sheet per card.** Then the settings live
  one tap deeper than the outlet, behind a control that is not obviously there,
  and a newcomer never finds them. The owner's framing is that the page *is* the
  outlet's settings.
- **A dropdown instead of chips.** Every other single-outlet surface uses chips,
  and a different control here makes the picker change shape as the owner moves
  between screens. `tablets-one-outlet-at-a-time` rejected this for the same
  reason.
- **Rename the navigation entry to "Outlet settings".** It is longer in a phone
  drawer that already holds four groups, and it would need matching changes to
  the auth end-to-end assertions on labels. The page reads as settings from its
  content. **If the owner asks for the rename at the checkpoint, it is a
  one-line registry change plus those assertions**, and the checkpoint decides.
- **A multi-select mode.** Overview is the cross-outlet view (see the proposal).

## RLS, money and offline

None. No table, column, policy or function changes. No money path is touched.
The surface is a personal-device screen, never the counter.
