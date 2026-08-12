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
