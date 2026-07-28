# Outlet Deletion: The Populated Refusal Never Walked In Production

**Type**: Verification gap · **Status**: Open, accepted at archive · **Area**: Outlets

## Expectation

Everything `outlet-deletion` (#20) claims in its gate has been seen working
against real data, in production, at least once.

## Current behaviour

The gate has two halves. The first — **an outlet with nothing attached is
deleted from the app by the owner** — was walked in production on 2026-07-28:
the nameless outlet created by a manager was marked closed and deleted through
the app, by the owner, and is gone.

The second — **one with anything attached refuses with a sentence naming what
is still there** — was archived on the strength of demo and local verification
rather than a production walk, with the owner's agreement on 2026-07-28.

It could not have been walked in production at the time: **production held zero
roster rows and zero dependent records of any kind**, so there was nothing
anywhere that could have refused a delete.

## Why this is not simply "untested"

The refusal is covered at four layers, including a visual read of the actual
sentence:

- `supabase/tests/11_outlet_deletion.sql` refuses a delete against an outlet
  carrying a roster row, a profile and a counter device in turn, and asserts
  **every referencing row still exists afterwards** — the no-cascade property,
  which is what makes "empty it, then delete it" work at all.
- The same file proves the reference counts are read from the catalog rather
  than a maintained list, by creating a new referencing table inside the test
  and confirming it appears without the function being edited.
- `supabase/tests/rest/outlet-deletion.test.ts` calls the counting function as
  the app calls it, over PostgREST, and confirms a populated outlet's delete
  arrives as `outlet_in_use` with the outlet still present.
- `outlets-surface.test.tsx` asserts the surface renders the counts as words
  and never leaks a constraint name.

And the sentence itself was read on a phone viewport in demo mode, in both
themes, by walking the whole flow — mark closed, delete, refuse:

> **This outlet was not deleted. Things are still attached to it:**
> · staff on the roster — 1
> · app accounts — 2
> Move or remove them and the outlet can be deleted then — there is nothing
> here to re-mark afterwards.

What is missing is not the behaviour, the wording, or the boundary. It is the
one thing fixtures cannot supply: **real rows, at a real outlet, that a real
owner is surprised to find still attached.** The demo's counts come from
fixture collections; production's would come from foreign keys.

## What would close it

One walk, and it costs nothing once anybody is rostered:

1. Mark a live outlet that has staff closed.
2. Press Delete and accept the confirmation.
3. Read the refusal. Confirm it names what is attached, that the counts match
   what is actually there, and that it reads like a sentence rather than a
   database error.
4. Cancel. Nothing is created and nothing needs cleaning up.

**Do not create a roster row purely to test this.** `employees` has no client
delete path, so a throwaway row could only be removed with the service-role
credential — and until it was, it would pin its outlet as permanently
undeletable, which is the exact trap #20 exists to prevent.

## Trigger

The first real staff member is added to a live outlet — at which point this is
a thirty-second check rather than a piece of work.
