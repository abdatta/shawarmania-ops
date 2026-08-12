# The Owner Can't See the Real Billing Counter From Home

**Area:** Owner console / Demo · **Reported:** 12 Aug 2026, Kalyani outlet

## What's wrong

The owner wants to open the billing counter screen from their own phone,
away from the outlet, to see what it actually looks like with real data —
without risking touching real, live records. The idea: take one snapshot of
the real data, then let the owner poke around freely after that in a safe
"practice" copy that never saves anything for real.

While exploring this, the owner also noticed an "End Shift" button on the
real counter that never shows up in the practice/demo version — so even the
demo doesn't fully match what the real counter looks like.

## Why this happens

- The practice/demo mode today is built entirely from made-up example data.
  It has no way to load a copy of real outlet data at all.
- The demo version of the billing counter and the real one are actually
  **two different setups behind the scenes** — not just the same screen with
  different data. The real counter tablet has features (like "End Shift")
  that the demo version's setup was never built to have.

## What a fix could look like

- This is a real feature to design, not a small fix: it needs a safe way to
  copy a snapshot of one outlet's real data into a practice mode, and it
  needs the practice mode's counter screen to actually match the real one
  (including things like "End Shift").
- Worth a proper design conversation before building, since it touches both
  the demo system and the real counter's session setup.

## Code hint (for whoever builds this)

- Practice/demo mode always uses made-up data: `src/data-access/mock/index.ts:63-71`
- Demo mode is not allowed to import real data code at all (on purpose, for
  safety): `docs/DEMO_MODE.md:80`
- The real "End Shift" ("Finish day") button: `src/features/counter/counter-shell.tsx:123-130`
