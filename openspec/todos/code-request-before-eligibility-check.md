# The App Asks for a Code Before Checking If the Person Is Even Allowed

**Area:** Counter / Billing · **Reported:** 12 Aug 2026, Kalyani outlet

## What's wrong

At the counter tablet, you can type in **anyone's** name to try to start a
billing shift — even someone who isn't allowed to run the counter. That
person then gets a notification on their own phone asking them to enter a
code. Only after they type the code does the app say "sorry, you're not
allowed."

The owner wasted time and effort figuring out Arpita wasn't allowed to bill
yet, because the app let them get all the way to "enter your code" before
saying no.

## Why this happens

- The tablet's name box doesn't check anything — it accepts any text typed
  into it.
- The app is built to give the exact same response whether the name typed in
  is a real eligible person or not. This was done on purpose in general (so a
  stranger can't guess who works there by watching what error shows up), but
  it also hides genuine mistakes from the person setting things up.
- The actual check — "is this person even allowed to bill here?" — only
  happens at the very last step, after the correct code is typed in.

## What a fix could look like

- Tell the admin sooner (ideally right when they type the name, or right
  after) if that person isn't eligible to bill yet — while still keeping the
  "can't be guessed by a stranger" protection for people who aren't even
  employees.
- At minimum, make the final "not eligible" message clearer about *why*, so
  it's obvious it's a setup problem and not a typo.

## Code hint (for whoever builds this)

- The tablet's name field: `src/features/counter/shift-request-screen.tsx:117-134`
- Where the request is created (before checking eligibility): `supabase/migrations/20260810000001_counter_tablet_and_shift.sql:578-633`
- Where eligibility is finally checked (too late): `supabase/migrations/20260810000001_counter_tablet_and_shift.sql:739-745`

## Considered and declined by #35

`multiple-billing-devices` (#35) opens both files named above: it reshapes the
same migration and rebuilds the shift-request path so each tablet runs its own
shifts. Taking this note there would have cost almost nothing in edits, and it
was declined anyway on 2026-09-02.

The reason is that the two changes want opposite things from a refusal. #35's
setup story depends on every refusal being **one indistinguishable response** so
a stranger cannot learn who works at an outlet by reading error messages, and
this note asks for a refusal that says more, sooner, to the admin who typed the
name. Both are right for their own reader. Deciding how much a refusal may
disclose, and to whom, is a policy question with an RLS shape, and it deserves a
change that argues it rather than a paragraph inside a concurrency one.

So this stays open with its own home to be chosen. The cheap half of the fix, the
final message saying clearly that this is an eligibility problem rather than a
typo, does not need the policy argument settled and can travel in any change that
touches the shift-request screen.
