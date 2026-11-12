## 1. Fix

- [x] 1.1 `e2e/page-width.spec.ts`: every page in the owner's, a manager's and a staff member's rail keeps its content within `max-w-2xl` at 1600px, Analytics within `max-w-5xl` (fails today on Billing)
- [x] 1.2 Billing's root and the Home approval cards take `mx-auto max-w-2xl`
- [x] 1.3 Overview, Menu, Team, staff Home and My attendance move to `max-w-2xl`
- [x] 1.4 `docs/DESIGN_SYSTEM.md` Page width section; pointers in `docs/SCREENS.md` and `AGENTS.md`

## 2. Gate

- [x] 2.1 The new test fails with 1.2–1.3 reverted and passes with them, on the desktop project
  _(4 November: reverted, owner and admin fail on Billing at 1,395px; restored, all three shells pass.)_
- [x] 2.2 Overview, Team, Menu and Billing looked at in the browser at desktop width: nothing wraps or crowds at the narrower column
  _(4 November, 1440px demo: Billing sits in the column; Overview's revenue line stays on one line; Menu is unchanged. Team's Works at wraps a long outlet name onto a second line, which reads cleanly.)_
- [x] 2.3 Quick gates pass, pushed to `stage`, Staging green, and the staging build carries the commit
- [x] 2.4 After the owner's Promote, Billing on the owner's laptop stops at the column
  _(`088bf93f` reached production with Deploy `96a1ab1b`, 4 November 16:32 UTC.
  12 November, production's demo at 1,600px: the owner's Billing holds its
  content in one centred 588px column.)_
