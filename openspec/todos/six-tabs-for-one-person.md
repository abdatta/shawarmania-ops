# Six Tabs For One Person

**Area:** App shell / Navigation · **Raised:** 1 Sept 2026 · **Type:** Known
gap against a stated requirement

## What the requirement says

`app-shell` states that a phone-first shell presents **no more than five
top-level navigation entries**, and that the bottom bar never requires
horizontal scrolling to reach one.

## Where it does not hold

**A manager who also works a shift at another outlet sees six.** They hold a
Franchise Admin assignment at one outlet and an Employee assignment at another,
which is a real shape the business already has and the one
`multi-outlet-people` exists for. Navigation is the union of what they reach, so
they get:

Home · Today · Finances · Attendance · Setup · My attendance

Two of those are homes — the Employee's and the manager's — because a home
belongs to a role you hold and this person holds both. Everybody else is inside
the ceiling: the owner sees four, a manager sees four, an Employee sees three,
and an owner who also runs a shop sees five.

## What is already true

**It is not a regression, and it is much better than it was.** That person saw
**eleven** flat entries before `navigation-groups-and-surface-cull` (#51), on a
bar that scrolled sideways with most of it off the edge. The change took it to
six.

**The bar no longer scrolls for them.** Tabs share the bar's width equally with
a floor of one phone touch target, so six clear the narrowest phone anybody
uses. At the previous per-tab minimum they overflowed a 375px phone by three
pixels. So the harm the requirement is really about — an entry you cannot reach
without knowing to scroll — is gone; the count is what still disagrees.

`src/gates/registry.test.ts` holds both facts to account: it asserts the width
property for every session shape the app can produce, and it pins each shape's
count, so this cannot drift further without a failing build.

## Why it was not fixed in #51

Every candidate is a product decision the owner has not been asked:

- **Losing the Employee Home is not available.** It is where the check-in button
  lives, and it is the one action their manager role cannot perform for them.
- **Folding My attendance into a group** was considered and closed during #51 on
  the grounds that it stays a tab; that reasoning assumed this person saw five,
  which was a miscount.
- **A third group**, or folding one home into the other, changes what every
  reader sees to fix what one reader sees.

## Trigger to promote

Somebody actually holding both roles says the bar is crowded — or a further
surface is added that would push a more common shape past five, at which point
the ceiling needs deciding properly rather than per-case.
