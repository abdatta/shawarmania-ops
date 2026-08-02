## Why

The rule already exists. `design-system` requires that a surface waiting on a
read "SHALL show a placeholder that occupies approximately the space the loaded
content will occupy, rather than a line of text", as a single shared component
so that "every surface waits in the same way and no screen invents its own".

Four attendance surfaces honour it. Eighteen other call sites show
`<p className="text-sm text-content-muted">Loading…</p>`, which is one line tall
where a list of cards, a table, or a counter grid is about to appear. Every one
of those reads ends in a reflow: the controls above the results jump when the
results land. The requirement was written during attendance and never carried
past the surface that prompted it.

There is a second gap, in the component itself. `LoadingList` is N blocks of a
fixed card height and `LoadingBlock` is one strip of a fixed height, so the
shared placeholder reserves *a* space rather than *the* space. A ledger table, a
row of stat tiles on the owner and admin homes, and the billing counter grid
each wait behind a silhouette that is not theirs, which reserves the wrong
height and reflows anyway, only less obviously.

## What Changes

- **The shimmer becomes the app's loading language, everywhere.** All eighteen
  text-line call sites are converted, including the session boot in
  `src/auth/real-root.tsx`. Nothing is left half-converted: after this change
  no surface waits behind a sentence.
- **The shared component grows shape variants**, so a surface reserves its own
  silhouette rather than a generic card stack. New variants cover the shapes the
  app actually renders: a table of rows, a row of stat tiles, a form, a detail
  panel, and the counter grid. The existing list and block variants stay.
- **Every variant keeps the current accessibility contract.** A `role="status"`
  region that is `aria-busy` and `aria-live="polite"`, an `sr-only`
  "Loading {label}…" naming what is waiting, blocks that survive
  `prefers-reduced-motion` so the wait is never carried by animation alone, and
  no hex literals, semantic tokens only. These are already asserted in
  `src/components/ui/loading.test.tsx` and the assertions extend to the new
  variants.
- **The design-system doc reverses its spinner allowance.**
  `docs/DESIGN_SYSTEM.md` currently reads "spinners are acceptable on manager
  screens". It will state the shimmer as the default loading language instead,
  and say that the shape belongs to the page.
- **Shape drift gets two non-blocking guards.** An ESLint rule at `warn` level
  flags the `Loading…` text literal outside the loading component, so a new
  surface cannot quietly reintroduce the sentence. `AGENTS.md` and the apply and
  archive steps gain one line: a change that alters a surface's layout reshapes
  that surface's shimmer in the same change.

## Capabilities

### New Capabilities

None. The capability already exists and this change strengthens it.

### Modified Capabilities

- `design-system`: the "Loading reserves the space of what is loading"
  requirement gains three obligations. The placeholder's shape SHALL match the
  shape of what is loading rather than a generic block stack; the placeholder
  SHALL be the only loading affordance in the app, with no surface falling back
  to a line of text or a spinner; and a change that alters a surface's layout
  SHALL reshape that surface's placeholder in the same change.

## Impact

**Code.** `src/components/ui/loading.tsx` and its test gain variants. Eighteen
call sites change their loading branch only: `src/auth/real-root.tsx` and the
surfaces under `src/features/` for accounts, overview (staff, owner, admin
homes), expenses, outlets, billing (counter, shift unlock), menu, cash, alerts,
inventory (surface, movement ledger), and insights (comparison, outlet day view,
P&L, reports). No data access, state machine, or loading *condition* changes:
when a surface decides it is waiting is untouched, only what it renders while it
waits.

**Config.** `eslint.config.js` gains one `no-restricted-syntax` entry at `warn`.
The build stays green regardless of what it finds.

**Tests.** Existing surface tests that assert on the "Loading…" text will need
their assertions moved to the placeholder's busy region. No new per-surface test
suites are added.

**Docs to update before archiving.** `docs/DESIGN_SYSTEM.md` (the loading rule
and the spinner allowance) and `AGENTS.md` (the reshape obligation). The
`/opsx:apply` and `/opsx:archive` step definitions gain the same line.

## Non-goals

- **No automated drift detection.** No script that renders loading and loaded
  states to compare their structure, and no per-surface parity tests. This was
  considered and declined: the shapes set here are the baseline and the
  checklist keeps them honest from there.
- **No CI gate of any kind.** The lint rule is `warn`, not `error`. No
  `continue-on-error` reporting job, no pre-commit hook. Nothing added by this
  change can turn a build red.
- **No change to loading conditions.** Which reads are considered pending, and
  when a scope change invalidates what is on screen, are already specified and
  working. This change replaces the rendered placeholder, nothing upstream of it.
- **No change to optimistic UI on the billing write path.** The counter still
  never blocks on a write. This is about reads.
- **No visual redesign.** The shimmer keeps its current treatment: bordered,
  raised-surface blocks with Tailwind's `animate-pulse`. Only its shapes grow.
