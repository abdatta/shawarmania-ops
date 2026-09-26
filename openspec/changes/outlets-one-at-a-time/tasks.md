# Tasks: outlets-one-at-a-time

> **UI first, and the owner is a hard stop.** Same instruction as #56 and #57.
> **Section 2 is a gate, not a note.** Nothing in section 3 begins until the
> owner says the layout is settled. The layout is the whole change, and there is
> no cheaper moment to change it than before the tests are written against it.

> **`each-outlet-chooses-how-it-serves` builds on this page.** Settle this one
> first. Its settings sections go in the gap marked in `design.md`'s sketch, and
> its own owner checkpoint is easier to run on a page the owner has already
> accepted.

## 1. The One-Outlet Page, In The Demo

- [ ] 1.1 Move the Outlets surface onto `useOutletScope` in single-select mode. It draws no picker for a reader with one outlet. Check whether the hook offers closed outlets; if it does not, pass this surface's own list rather than widening the hook (design D1).
- [ ] 1.2 The outlet section: identity (name, location label, address), the existing *what this outlet is raising* block and tablet state, then **Name and address**, **Location** and **Tablets** as rows that each state their answer on the right (design D2). Each row opens exactly what the card's button opened.
- [ ] 1.3 Closing, reopening and deleting move to a separate section at the bottom (design D3). Keep their dialogs, wording and refusals byte-for-byte.
- [ ] 1.4 A closed outlet: its chip reads *closed*, and its page opens on the reopen action.
- [ ] 1.5 The manager's page: same outlets their assignments name, no Add, no Edit, no capture, no bottom section, and the Tablets row as reachable as before.
- [ ] 1.6 `outlets/:outletId` opens on that outlet and writes it into the remembered choice, with the fallback in design D4.
- [ ] 1.7 Reshape the shimmer to one outlet's page (design D5).
- [ ] 1.8 Demo fixtures already hold two outlets and a closed one. Confirm the walk covers switching, a closed outlet, and a manager with one outlet (no picker).
- [ ] 1.9 SECTION GATE: at `/demo`, on phone and tablet widths in both themes, the owner switches outlets, opens each row, reaches a closed outlet and reopens it, and a manager opens their one outlet with no picker and reaches its tablets.

## 2. 🧍 OWNER CHECKPOINT — STOP HERE

- [ ] 2.1 Hand the owner the demo and let them walk it. Ask the one open question from `design.md`: whether the navigation entry should read *Outlet settings*. Iterate on section 1 as they ask.
- [ ] 2.2 Record in `design.md` what changed between the sketch and what the owner settled on.
- [ ] 2.3 CHECKPOINT GATE: the owner states the layout is settled. Nothing below begins before this.

## 3. Pin It And Prove It Against The Real Backend

- [ ] 3.1 Rewrite `outlets-surface.test.tsx` and `outlets-for-managers.test.tsx` for one outlet at a time: switching replaces, one outlet draws no picker, a closed outlet is reachable by the owner and not offered on another surface's picker, the address opens its outlet and falls back for an outlet the reader cannot see, and destructive actions sit apart.
- [ ] 3.2 Every control the card offered still reaches the same flow. For each of edit, capture, tablets, close, reopen and delete, add a test that fails if it is missing from the owner's page.
- [ ] 3.3 A manager's page still refuses nothing that was not refused before, and still offers nothing it did not offer before. The database refusals are unchanged, so no new isolation case is owed. Say so in the verification report rather than leaving it implied.
- [ ] 3.4 Run the full gate list from `AGENTS.md`, including `test:e2e:auth`: Outlets is inside the Setup group both admin shells land beside.
- [ ] 3.5 SECTION GATE: every suite green, and the live app at the owner's and a manager's session shows the page the owner settled on.

## 4. Docs And Phase Gate

- [ ] 4.1 Update `docs/SCREENS.md`, `docs/OPERATIONS.md` (onboarding runbook steps) and `docs/DEMO_MODE.md` (walkthrough step).
- [ ] 4.2 🧍 The owner uses the page on their own phone in production. Tasks complete is not the archive trigger; real use is.
- [ ] 4.3 PHASE GATE: Outlets opens on one outlet and shows only that outlet. The picker replaces the choice rather than adding to it, and nobody who can see only one outlet is offered a picker. The page keeps every action the card had: edit, capture, tablets, close, reopen and delete. It still says what the outlet is raising and how its tablet is. The address `outlets/:outletId` opens on that outlet. The owner settled the layout in the demo before any of it reached production, and the four-role demo walkthrough still walks. (This change has no roadmap row; its checkpoint is the gate in its own proposal banner.)
