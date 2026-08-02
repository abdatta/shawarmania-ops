## Context

`src/components/ui/loading.tsx` exports two components. `LoadingList` renders N
blocks of `h-24`, `LoadingBlock` renders one block of `h-16`, both from the same
`rounded-xl border border-border bg-surface-raised` treatment with Tailwind's
`animate-pulse`. Between them they carry the accessibility contract the spec
requires: `role="status"`, `aria-busy`, `aria-live="polite"`, an `sr-only`
"Loading {label}…", and no dependence on motion, all asserted in
`loading.test.tsx`.

They are used four times, all in attendance. Eighteen other call sites render a
line of text. The surfaces behind those call sites are not one shape: a survey
of them finds `space-y-3` stacks of `Card`, `ul` lists of cards, `Card`s filled
with label/value `Row`s (cash figures, P&L, reports), a `DataTable` from
`src/components/layout/data-table.tsx` (comparison), forms (`space-y-4` in
inventory), and the billing counter's two-pane
`md:grid-cols-[minmax(0,1fr)_20rem]`. A single card-stack placeholder is the
right shape for perhaps half of them.

### The eighteen are the complete set, not just the findable ones

Searching for the loading sentence finds surfaces that say they are waiting. It
cannot find a surface that says nothing and renders an empty region, so the
absence of a nineteenth was checked directly rather than assumed. Six files do
async work with no loading affordance, and every one is a write or a provider:
`check-in-card.tsx` (check in and out, a disabled button reading "Saving…" or
"Finding your position…"), `sign-in.tsx`, `activate.tsx` and `account-menu.tsx`
(form submits and sign-out, pending states on their controls), and
`outlet-scope.tsx`, a provider that exposes `outletId: string | null` and leaves
the wait to its consumers, which are already in the eighteen.

So no screen is being left behind. Nothing about this change is deferred to a
later one.

**The read/write boundary this establishes is load-bearing for implementation.**
A pending write stays on its control and does not become a placeholder. Replacing
a submitted form with a shimmer would hide the thing the reader is waiting to
hear about, and "no surface waits behind a sentence" must not be read as licence
to convert `check-in-card`'s "Saving…" into a shape. The spec now says this
explicitly.

**No non-negotiable constraint is engaged by this change.** There is no RLS
policy, no money arithmetic, and no offline or sync semantics anywhere in it.
It replaces what a surface renders while a read is pending. It does not change
when a read is considered pending, what is read, or who may read it. The counter
still never blocks on the network, because this touches reads and the counter's
guarantee is about writes.

## Goals / Non-Goals

**Goals:**

- One loading language across every surface and the session boot, with no
  sentence or spinner left anywhere.
- A placeholder whose shape is the page's shape, so the reserved space matches
  what arrives rather than approximating it.
- The existing accessibility contract preserved identically on every new shape,
  not reimplemented per shape.
- Two guards against future drift, neither of which can fail a build.

**Non-Goals:**

- Automated detection of shape drift, in any form (declined by the owner).
- Any CI gate, error-level lint, or hook.
- Changing loading conditions, data access, or optimistic write behaviour.
- A visual redesign of the shimmer treatment itself.

## Decisions

### D1. A primitive plus a region wrapper, not a fixed catalogue of variants

The module exports a `Shimmer` primitive (one animated block, sized by the
caller through `className`) and a `LoadingRegion` wrapper that owns the
semantics: the `role="status"` element, `aria-busy`, `aria-live`, and the
`sr-only` "Loading {label}…". A surface composes `Shimmer` blocks inside
`LoadingRegion`, laid out with **the same container classes its loaded content
uses**.

Concretely, a surface whose results render in `<div className="space-y-3">`
renders its placeholder in `<LoadingRegion label="…" className="space-y-3">`
with `Shimmer` blocks inside. The layout is copied from the page, so it is the
page's shape by construction.

*Alternative rejected: a fixed catalogue of shape variants* (`LoadingTable`,
`LoadingTiles`, `LoadingForm`, `LoadingGrid`, and so on). A catalogue cannot
cover eighteen surfaces that genuinely differ, so it ends up either enormous or
approximate, and an approximate variant is the problem this change exists to
fix. Worse, it inverts the pressure: a new surface picks the nearest catalogue
entry and bends to it, rather than reserving its own shape.

*Alternative rejected: skeletons that reuse each page's real row component in a
placeholder mode.* This is the only approach where shape drift is impossible by
construction, and it was considered seriously. It requires extracting a row
component on surfaces that do not have one, which is a refactor of roughly
fifteen files well beyond this change, and it pushes placeholder concerns into
components whose job is rendering data. Recorded here because it remains the
right answer if the checklist proves insufficient.

### D2. Named shapes for the four recurring cases, built on the primitive

Composition everywhere would make eighteen call sites verbose for shapes that
repeat. So the module also exports named shapes for the four that actually
recur, each a thin composition of `LoadingRegion` and `Shimmer`:

- `LoadingList` (kept, unchanged signature) for a stack of cards, with an added
  optional block height so a stack of short figure cards does not reserve the
  height of tall outlet cards.
- `LoadingBlock` (kept, unchanged signature) for a single strip.
- `LoadingTable` for the `DataTable` shape: a header strip and N row strips.
- `LoadingFigures` for a card of label/value rows, which is the shape cash,
  P&L, and reports all share.

Anything that is not one of these four composes the primitive directly. The
counter's two-pane grid and the inventory form are expected to.

Keeping `LoadingList` and `LoadingBlock` signature-compatible means the four
existing attendance call sites do not change at all.

### D3. The session boot waits behind the shell it is about to render

`real-root.tsx` resolves the session before it knows the role. Its placeholder
is the app shell's silhouette (a header strip and a content block), not a card
stack, because a shell is what appears next. This is the one placeholder that
cannot name what is loading in domain terms, so its label is "the app".

### D4. The lint rule matches JSX text, at `warn`, with the module exempt

A `no-restricted-syntax` entry matching a `JSXText` node containing `Loading`,
scoped to `src/**/*.tsx` and ignoring `src/components/ui/loading.tsx`. Message
points at the loading module and the design-system doc, following the pattern
the existing architectural rules in `eslint.config.js` already use.

Severity is `warn`, deliberately and by explicit instruction. It appears in the
editor and in `npm run lint` output and fails nothing.

*Alternative rejected: `error`.* The owner declined a blocking gate.

*Alternative rejected: matching the `text-content-muted` class instead.* That
class is legitimate on hundreds of nodes; the loading sentence is identifiable
by its text, not its styling.

Note the honest limit: this catches the literal sentence. It does not catch a
surface that renders nothing while waiting, or one whose shimmer is the wrong
shape. Those are the checklist's job.

### D5. The reshape rule goes in AGENTS.md § Design and in both workflow steps

`AGENTS.md` has a `### Design` section under `## Hard Rules`, which is where a
rule agents must follow belongs. One line there, and the same line in the
`/opsx:apply` and `/opsx:archive` step definitions so it is restated at the two
moments work is actually being done and finished.

Wording: *if a change alters a surface's layout, that surface's shimmer is
reshaped in the same change.*

### D6. The treatment does not change

Same border, same raised surface, same `animate-pulse`. Tailwind's `animate-pulse`
already respects `prefers-reduced-motion`, which is what makes the existing
reduced-motion assertion hold, and rebuilding the animation would put that at
risk for no gain. No hex literals: the primitive reads `border-border` and
`bg-surface-raised`, as the current test asserts.

### D7. Existing tests move their assertion to the busy region

Surface tests that currently assert on the string "Loading…" assert instead on
the `role="status"` region, which is more accurate about what is being promised
anyway. This is a mechanical edit at each affected test, not new test suites.

## Risks / Trade-offs

**Composition lets a surface reserve a shape that is subtly wrong, and nothing
will say so.** → Accepted, knowingly. The two guards are preventive, not
detective; the owner declined detection. The mitigation is that the shapes set
in this change are reviewed once, carefully, as the baseline.

**Eighteen call sites in one change is a wide diff.** → Each edit is confined to
a single loading branch, with no change to the surrounding component. The four
attendance sites do not change at all, which keeps the only surfaces with
existing shimmer coverage as an untouched control.

**A `warn` that nobody reads is worth nothing.** → True, and accepted. It exists
to make the regression visible at the moment it is typed, in the editor, which
is where it will most likely be seen.

**Verbose placeholders drift from the layout they copy.** → This is the drift
the checklist targets. Copying the container classes at least makes the
divergence visible in a diff, since the placeholder and the content sit in the
same file.

## Migration Plan

Purely presentational and shipped in one pass. There is no data migration, no
schema change, and nothing to roll forward or backward at the database. Rollback
is a revert of the commit.

Order of work: grow the module and its tests first, so every call site has
something correct to call; then convert surfaces, reading each one's loaded
layout before writing its placeholder; then the docs and the two guards last, so
the rule lands with the code already obeying it.

## Open Questions

**Whether the billing counter keeps its placeholder.** The menu read is fast and
the counter is the one surface where a flash of placeholder could read worse
than a brief empty pane. This is deliberately not being settled on paper: the
placeholder gets built like every other surface's, and the decision is taken at
task 9.6 by looking at the built thing on both a throttled and a fast
connection.

If it becomes an exception, it is a **named exception in
`docs/DESIGN_SYSTEM.md` with its reason**, plus a scenario in the
`design-system` delta permitting it. An undocumented gap is not an acceptable
outcome, because the value of "every surface waits the same way" comes from
being able to trust it without checking, and a silent exception spends that
trust. One documented exception costs nothing; one silent one costs the rule.
