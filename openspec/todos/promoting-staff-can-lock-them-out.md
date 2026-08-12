# Promoting a Staff Member Can Accidentally Lock Them Out

**Area:** Staff / Roles · **Reported:** 12 Aug 2026, Kalyani outlet

## What's wrong

The owner wanted to give Arpita an extra job — she was already staff, and they
wanted to also make her a Biller (someone who can run the billing counter).

There was no simple "add this role" button. The only way was to end her
current assignment and create a new one. Ending it came with a checkbox that
was **already ticked** to also deactivate her account — and since it was
ticked by default, it quietly logged her out of everything, not just her old
role.

## Why this happens

- The app only allows **one active role per person per outlet** right now.
  You can't stack a second role on top of an existing one.
- So the only path to "add a role" is: end the old one, then start a new
  one.
- When you end someone's *only* assignment, the "also deactivate this
  account" checkbox is checked by default — even if you're about to
  immediately give them a new role.
- This makes a routine promotion look and feel like firing someone.

## What a fix could look like

- Let an admin add a second role at the same outlet without ending the first
  one. (Best fix, but bigger change.)
- Smaller fix: don't default that "deactivate" checkbox to checked when the
  admin is clearly in the middle of reassigning someone (e.g., they open the
  "assign new role" screen right after).
- At minimum: make it very clear, in the moment, that ticking that box logs
  the person out immediately.

## Code hint (for whoever builds this)

- One-live-assignment-per-outlet rule: `supabase/migrations/20260729000004_multi_outlet_people.sql:90-92`
- The "End assignment" screen and its checkbox: `src/features/accounts/accounts-surface.tsx:1026-1103`
