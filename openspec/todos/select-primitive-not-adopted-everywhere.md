# Two Ways To Draw A Dropdown

**Type**: Tech debt · **Status**: Open · **Area**: Design system

## Expectation

Every dropdown in the app looks and behaves like every other one, and a change to
how they look is one edit.

## What is there now

`ui-outlet-operations` (#7) added a shared `Select` primitive alongside the
existing `Input`, because the four surfaces it built needed six dropdowns between
them and hand-repeating the class string a seventh time was how the divergence
starts.

The five dropdowns that existed before it — two on **Access**, three on **Staff**
— still carry that class string inline. They render identically today, which is
exactly why this is easy to leave alone and easy to get wrong later: the next
person to adjust the control's height or focus ring will change one of the two
and not notice the other.

## Why it was not done in the same change

Migrating them touches two surfaces neither change owns, for no behaviour
difference. The rule in this repo is that discovered scope goes here rather than
being absorbed silently.

## What doing it looks like

Replace the five inline `<select>` elements in
`src/features/accounts/accounts-surface.tsx` and
`src/features/employees/employee-roster.tsx` with `Select`. The elements stay
native `<select>`s, so every existing test that queries by label or role keeps
passing — which is also what makes this safe to do in a single mechanical pass.

## Trigger to promote

The next change that touches either surface, or the first time the control's
shared styling actually changes.
