# Page Headers Reserve Their Own Space

**Type**: Defect · **Status**: Found, not scheduled · **Area**: Design system

## Expectation

A surface whose header title and subtitle arrive with a read shows a header of
the height it will settle at, so that the content beneath it does not drop when
the title resolves. This is the same rule
[`design-system`](../specs/design-system/spec.md) already applies to a surface's
body: content arriving must not shift what is already on screen.

## Current behaviour

`shimmer-as-default-loading` converted every body placeholder to a shimmer
shaped like what lands on it. Headers were deliberately out of its scope, and
they still jump.

The clearest case is the stock movement ledger
(`src/features/inventory/movement-ledger.tsx`). While the item read is pending
the header reads a bare **"Ledger"** with no subtitle; when it resolves it
becomes the item's name plus a two-line subtitle
(*"Cheese slices — Now: 9.9 packet. Every figure on this screen is the sum of
the rows below it."*). The header grows by roughly two lines and pushes the
whole table down, immediately after the table's own placeholder had reserved
its space correctly. The body no longer reflows; the header still does.

The same shape of problem exists anywhere `PageHeader` takes a `title` or
`subtitle` derived from a pending read rather than from the route.

## Why it was not fixed in that change

That change's scope was explicitly the loading branch of each surface and
nothing around it — eighteen call sites, each edit confined to what renders
while a read is pending. Reserving header space means changing what `PageHeader`
renders when its title is not yet known, which is a change to a shared layout
component and to every caller's idea of what a header is. That is a different
change with a different blast radius.

## Sketch of a fix

Give `PageHeader` a pending state: `title` and `subtitle` accept `undefined`
meaning *not yet known*, and the header renders shimmer strips at the type
sizes it will use rather than collapsing. Callers that already pass a static
route-derived title are unaffected, because theirs is never pending.

Worth checking at the same time whether the subtitle's line count can be
reserved honestly — a one-line subtitle reserving two lines trades one jump for
another.
