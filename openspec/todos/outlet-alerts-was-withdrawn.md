# Outlet Alerts Was Withdrawn

**Type**: Withdrawn plan · **Status**: Closed unless the trigger fires · **Area**: Operations

## What was withdrawn

The `outlet-alerts` capability whole, on 2026-08-31, deleted by
`#51 navigation-groups-and-surface-cull`: the Alerts surface for both the owner
and the manager, the alert thread, its status machine and the cross-outlet inbox.

It was built as demonstration in #7, shown in #8, and never promoted. No roadmap
change was ever scheduled to give it live data — it is the only capability in the
project that sat in `demo` with nothing planned behind it.

## Why

Two outlets, two owners who are also the managers, and a WhatsApp group. An
alert thread with a status machine is the shape a larger franchise needs; it is
overhead for a business where the person who would raise the alert and the person
who would resolve it are often the same person, already talking.

What an outlet is raising is now read **on that outlet's card**, derived from rows
that already exist, with nothing to click through to and nothing to mark
resolved.

## What survived

**The tables did.** `outlet_alerts` and `alert_responses` keep their columns,
their RLS policies and their enumerated isolation coverage in `outlet-tenancy` —
#51 deleted screens and touched no migration. They are recorded in
`docs/LIMITATIONS.md` as tables with no reader.

That means reinstating the feature is a UI change, not a schema change. The
model — a category, a priority, a subject and a message; a status that moves one
step at a time and ends terminal; a thread of responses; an owner who reads
across outlets and a manager who reads only their own; priority conveyed by more
than colour — is on disk in git history at
`openspec/specs/outlet-alerts/spec.md`.

## Trigger to reopen

A third outlet with a franchisee who is **not** one of the owners, so that
raising an issue crosses a boundary a WhatsApp group does not; or an issue is
lost between the shop and the owner and somebody asks where it went.
