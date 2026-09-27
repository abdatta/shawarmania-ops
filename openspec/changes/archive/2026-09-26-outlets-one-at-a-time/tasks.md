# Tasks: outlets-one-at-a-time

> **UI first, and the owner is a hard stop.** Same instruction as #56 and #57.
> **Section 2 is a gate, not a note.** Nothing in section 3 begins until the
> owner says the layout is settled. The layout is the whole change, and there is
> no cheaper moment to change it than before the tests are written against it.

> **`each-outlet-chooses-how-it-serves` builds on this page.** Settle this one
> first. Its settings sections go between Details and Tablets, as `design.md`'s sketch marks, and
> its own owner checkpoint is easier to run on a page the owner has already
> accepted.

## 1. The List And The Outlet's Page, In The Demo

- [x] 1.1 Outlets as a list like Team (design D1): name, short code and area, a Tablets line, a Status column (grey *Open*, red *Closed*, no dot), and a chevron; the whole row one link; closed outlets last and for the owner only; Add on the list opening the new outlet's page. `DataTable` gains `rowClassName`.
- [x] 1.2 The outlet's page at `outlets/:outletId` (design D2, D3, D5): title, short code and status; Details as tiles with Edit on its label and Recapture inside the fence tile; Mark closed centred at the foot, or Reopen and Delete outlet; Back through history, or to the list when opened first (`PageHeader.onBack`); *not one you can see* for an outlet outside the reader's policy. `useOutletActions` shared by both screens; `OutletSection` for each group's label.
- [x] 1.3 The Tablets page folded into the outlet's page and deleted (design D4): `outlet-tablets.tsx`; `devices-surface.tsx` and its test, the `devices` routes and both gates removed; Overview's status links to the outlet's page.
- [x] 1.4 Overview's status reads Online / Offline (design D6); `outletPresence` returns `online / partial / offline`; its tests and `outlets-overview.test.tsx` updated.
- [x] 1.5 Placeholders measured against the page (design D7).
- [x] 1.6 SECTION GATE: walked at `/demo` on a phone in dark (and a tablet in light for earlier rounds): list → page → Back to the list; Overview → page → Back to Overview; a page opened first → Back to the list; a closed outlet; a manager's list and page with every tablet action and no owner actions; a manager refused another outlet's page; add opens the new page; delete returns to the list. Five rounds are recorded in `design.md`.

## 2. 🧍 OWNER CHECKPOINT — STOP HERE

- [x] 2.1 Hand the owner the demo and let them walk it; iterate on section 1 as they ask. *(Five rounds, 2026-09-26.)*
- [x] 2.2 Record in `design.md` what changed between the first sketch and what the owner settled on. *(The rounds section.)*
- [x] 2.3 CHECKPOINT GATE: the owner states the layout is settled. **Settled 2026-09-26** ("I'm happy with the UI now").

## 3. Pin It And Prove It Against The Real Backend

- [x] 3.1 Port `devices-surface.test.tsx` (deleted, recoverable from git) to `outlet-tablets.test.tsx`: the out-of-touch lead, unsent counts, the setup code shown once, the move confirmation, removal naming what is lost, a manager's edit without move, an outlet with none, and each button's accessible name naming its tablet. *(`outlet-tablets.test.tsx`, 17 cases; the picker cases went with the picker. Two new: nothing to administer is offered to a reader who may not, and a tablet read that answers after the page moved to another outlet cannot publish.)*
- [x] 3.2 Rewrite `outlets-surface.test.tsx` and `outlets-for-managers.test.tsx` (red since section 1) for the list and the page: a row opens its page; closed outlets last and owner-only; Back through history and to the list when opened first; *not one you can see*; add opens the new page and delete returns to the list; the Status words with no dot. *(`outlets-surface.test.tsx`, 57 cases, and `outlets-for-managers.test.tsx`, 12. Rewriting them found a real regression: a refused add showed only inside its sheet, not on the list behind it as the card surface had. Fixed.)*
- [x] 3.3 Every control the card and the Tablets page offered still reaches the same flow: for each of add, edit, capture, close, reopen, delete, and set up, edit and remove a tablet, a test that fails if it is missing. *(`offers every action the card and the Tablets page had, to the owner` and `keeps every write it had`.)*
- [x] 3.4 Update the e2e specs that visit `devices/…` or assert the old list or Open/Closed on Overview (`owner-console.spec.ts`, `setup.spec.ts`, `attendance.spec.ts`, `operations.spec.ts`). *(Also caught one missed expectation in `setup.spec.ts`; the full demo suite then passed, 282 + the 94 re-run.)*
- [x] 3.5 A manager is refused nothing and offered nothing new; the database refusals are unchanged, so no new isolation case is owed. Say so in the verification report. *(No table, policy or function changed, so no isolation case is owed; the manager's page offers exactly what the database accepts — tablet actions at their own outlet, no outlet writes — and `not one you can see` for any other outlet.)*
- [x] 3.6 Run the full gate list from `AGENTS.md`, including `test:e2e:auth`. *(2026-09-26: format, lint including `lint:encoding`, typecheck, functions typecheck, contrast (60 pairs AA both themes), 1950 unit tests, build, the demo e2e suite, and against a fresh local stack `test:db` (2613 pgTAP), `test:rls`, `test:e2e:auth` and a clean `db:types` diff. `e2e-auth/overview.spec.ts` still expected the Tablets page from Overview's status and was updated.)*
- [x] 3.7 SECTION GATE: every suite green, and the live app at the owner's and a manager's session shows what the owner settled. *(Every suite green. The owner's and a manager's sessions against a real local backend are what `test:e2e:auth` walks; production is 4.2.)*

## 4. Docs And Phase Gate

- [x] 4.1 Update every page in the proposal's *Docs to update*. *(SCREENS, OPERATIONS, DEMO_MODE, GLOSSARY, ROLES_AND_PERMISSIONS, LIMITATIONS and ARCHITECTURE; OFFLINE_AND_SYNC named no Tablets page.)*
- [x] 4.1a At spec sync, reword *the Tablets surface* in `counter-device-sessions`, `billing-delivery` and `demo-mode` to the outlet page's Tablets section. The behaviour those requirements state is unchanged, but a reader should not go looking for a page that no longer exists. *(Done at sync, 2026-09-26: two lines in `counter-device-sessions`, two in `demo-mode`, one in `billing-delivery`.)*
- [x] 4.2 🧍 The owner uses the page on their own phone in production. Tasks complete is not the archive trigger; real use is. *(Deployed as `74bc73e` on 2026-09-26; the owner used it and signed off the same day.)*
- [x] 4.3 PHASE GATE: the gate in the proposal banner. (No roadmap row; the banner is its checkpoint.) *(Met: every clause of the banner gate held in production.)*
