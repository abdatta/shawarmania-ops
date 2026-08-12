# The "Awaiting Activation" Label Lies

**Area:** Staff / Roles · **Reported:** 12 Aug 2026, Kalyani outlet

## What's wrong

After sorting out Arpita's promotion (see
[Promoting a Staff Member Can Accidentally Lock Them Out](./promoting-staff-can-lock-them-out.md)),
her account now shows **"Awaiting Activation."** But she's not waiting for
anything — she's actively working and can log in fine.

## Why this happens

- While fixing the promotion, the owner clicked "Generate new code" for her,
  thinking it was needed. It wasn't — she already had an account and already
  knew how to log in.
- That click created a fresh, unused invite code sitting in the system for
  her.
- The "Awaiting Activation" label just checks one thing: **"does this person
  have any unused invite code?"** It does not check whether they've *already*
  logged in before, or whether they're currently working.
- So now the label is stuck showing "Awaiting Activation" forever, because
  nothing will ever use up that spare code.

## What a fix could look like

- Change the label so it only says "Awaiting Activation" for someone who has
  **never** logged in yet — not just "has an unused code lying around."
- Separately: warn an admin before they click "Generate new code" on someone
  who's already active, so this doesn't happen again to someone else.

## Code hint (for whoever builds this)

- The label's logic: `src/features/accounts/accounts-surface.tsx:327-332`
- The "Generate new code" button: `src/features/accounts/accounts-surface.tsx:350-357`
