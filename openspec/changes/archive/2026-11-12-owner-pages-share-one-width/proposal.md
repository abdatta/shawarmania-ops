# Proposal: owner-pages-share-one-width

> **Model**: Opus · **Kind**: production bug fix, not a roadmap change · **Gate**: none — owner, manager and staff pages away from the counter, styling only, and a revert cleanly undoes it; the new `e2e/page-width.spec.ts` fails with the fix reverted.

## Why

On a laptop, Billing ran edge to edge while every other owner and manager page stopped at a centred column. The shell's `<main>` caps nothing, so each page caps its own root, and Billing's root never did; the counter's approval cards above Home had the same gap. The pages that did cap had drifted to five different widths (`md`, `2xl`, `3xl`, `4xl`, `5xl`) with no recorded reason for any but Analytics, so moving between pages on a desktop shifted the column under the reader [owner, 2026-11-04].

## What Changes

- Billing's root and the Home approval cards take the standard column, `mx-auto max-w-2xl`.
- Overview and Menu (`3xl`), Team (`4xl`), and the staff Home and My attendance (`md`) move to the same `2xl`.
- Analytics keeps `max-w-5xl`: its charts and bars read better with the room [owner, 2026-11-04].
- `docs/DESIGN_SYSTEM.md` gains a Page width section stating the rule; `docs/SCREENS.md` and `AGENTS.md` point to it, so whoever builds the next page meets it.
- `e2e/page-width.spec.ts` opens every page in each role's rail at 1600px and fails if its content is wider than the column. It reads the pages from the rail, so a new page is checked without being listed.

## Change gate

No gate: a change away from the counter that a revert cleanly undoes. It narrows owner, manager and staff pages on a wide screen, is styling only, and writes nothing.

## Non-goals

- The counter and kitchen tablets, which are their own shells laid out to their screens, and the Biller's Open orders.
- Pages reached only from a row (an outlet's page, a change gate's page, a fixed cost's page) are not opened by the test; they share their list's file and already use `max-w-2xl`.
- No shared wrapper component: the class is one line on each root, and the test is what stops the next page forgetting it.
