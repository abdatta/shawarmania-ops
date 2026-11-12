# Proposal: retire-owner-access-in-the-database

> **Kind**: gate retirement, no roadmap row. Seeded 2026-11-12 when
> `a-deactivated-person-leaves-in-two-steps` (#82) was archived.

## Why

The `owner-access-in-the-database` gate (code `OD`, `retireBy` 2027-03-31) has
done its job. It was turned on in production at 13:05 IST on 3 November 2026 and
has stayed on: `change_gate_events` holds that one turn and nothing since. **It
was never pulled**, which under the owner's rule of 30 October holds nothing.
On 12 November the owner ruled that staging stands in for production use. On
staging, the owner's Add person offered no Owner role and Edit offered no owner
access; the REST probe refuses a hand-crafted grant on every Staging run.

Its off path is now dead code with a switch on it: the Owner role in Add person,
the *Owner access* section in Edit, and the account function accepting a grant.

One more reason to retire it. Until the page has read the switches, the form
treats this one as off and briefly offers Owner. The database would refuse the
grant, but retiring the gate removes that moment.

Nothing depends on it.

## What changes

This follows the `retire-gate` workflow (`.claude/skills/retire-gate/SKILL.md`),
in two halves.

- **Code.** Every toggle point keeps its on branch. Add person never offers
  Owner, Edit has no *Owner access* section, and an owner is locked against
  deactivation. The `admin-accounts` function always refuses to grant, end,
  switch off or mark as left owner access. Its round trip is `none:`, so the
  `@cg-on` tags drop and the off tests go. The key moves to
  `RETIRED_CHANGE_GATES`. The function deploys with the build.
- **Database later.** This waits until every registered device runs the
  retirement build and the counter has traded three services on it. Then a
  contract migration (`-- release: contract owner-access-in-the-database`)
  rewrites the `app_change_gate('owner-access-in-the-database')` reader to its
  on branch and retires the row. Re-run the reader query first.

## Change gate

No gate: a retirement keeps the behaviour already on.
