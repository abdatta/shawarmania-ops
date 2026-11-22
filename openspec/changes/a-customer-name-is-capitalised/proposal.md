# Proposal: A Customer Name Is Capitalised

> **Model**: Opus · **Kind**: correction to shipped behaviour, not a roadmap
> change (no row, no number) · **Depends on**: #56 `a-customer-is-a-phone-number`,
> #75 `a-release-can-be-switched-off` · **Gate**: with
> `customer-names-capitalised` on, a name typed at the counter for a new number
> entirely in small letters or entirely in capitals (`rahul das`, `RAHUL DAS`)
> is saved as `Rahul Das`, the counter shows that under the name box before it
> is saved, and one tap on **Keep as typed** saves it exactly as typed instead;
> a name typed in mixed case (`MD Rahim`, `d'Souza`, `McKenzie`) and a name of
> fewer than three letters are saved as typed, with no line shown; with the gate
> off the counter is exactly as today; the 747 saved customer names that are
> entirely lowercase or entirely capitals are corrected once, through the
> owner's own rename, with every bill's name left as it was, and the correction
> can be undone from its saved before-image

## Why

Read from production on 2026-11-22: of 2,107 saved customers, 1,331 names are
already capitalised word by word, **508 are all lowercase, 239 are ALL CAPS**,
and 29 mix the two. A quarter of the directory reads wrongly wherever a name
is shown: the counter's match card, the owner's Customers page, Gold members,
and the name a campaign greets a customer by.

The cause is deliberate. On 2026-09-19 the owner chose that the counter save a
name **exactly as typed**, because title-casing in code would mangle the names
the counter actually serves (`Sk Abdul`, `MD Rahim`, initials, `d'Souza`), and
the first name saved is the only one, since a till never rewrites a profile.
The tablet keyboard's `autoCapitalize="words"` was meant to make ordinary typing
come out right. It does not: a physical keyboard, a paste, caps lock and a
biller who simply types in small letters all ignore it.

The owner now wants names capitalised (2026-11-22), **and kept the reason the
old decision existed**: "if the counter really wants to write it in a different
case … it should not be a complete impossibility." So this change corrects only
the two shapes no deliberate spelling takes, entirely lowercase and entirely
capitals, shows the correction before anything is saved, and lets the biller
keep what they typed in one tap. Mixed case is taken as deliberate and left
alone, which is exactly the set of names the 2026-09-19 decision protected.

## What changes

**At the counter (behind the gate).** In the customer box, when a new number is
being saved and the name typed has three or more letters, all of them small or
all of them capitals, a line appears beneath the name field:

```
┌──────────────────────────────────┐
│ rahul das                        │   ← the field, exactly as typed
└──────────────────────────────────┘
  Saves as Rahul Das     [Keep as typed]
```

Typing is never interrupted: the field always holds exactly what was typed, and
the line updates as it changes. Confirming saves the line's name. **Keep as
typed** switches the line to `Saves as typed  [Capitalise]` and the name is then
saved exactly as typed; **Capitalise** switches it back. The choice holds until
the box closes, even if the name is edited after it. A name typed in mixed case,
a name of one or two letters, or a name with no capitalisable letters shows no
line and is saved as typed, as today.

The same name goes onto the order and bill being rung, exactly as it already
does. Nothing else at the counter changes: a returning customer's saved name is
shown and used as it is, and the saved profile is still never rewritten from a
till.

**Once, for the names already saved.** After the gate has been released, the
747 saved names that are entirely lowercase or entirely capitals and have three
or more letters are corrected by the same rule, through the owner's existing
rename (the correction the Customers page makes), run as the owner. Each
customer's saved profile changes; **every bill and order keeps the name it was
rung under**, as a rename always has. The old names are saved first, outside the
repository, so the correction can be undone name by name for any that the owner
finds were meant as typed. The 29 mixed-case names and the 94 one- and
two-letter names are left alone; the owner can correct any of them on the
Customers page, which saves exactly what is typed.

## Non-goals

- **Past bills and orders.** Their `customer_name` is history, snapshotted at the
  sale, and stays as it was rung. No receipt changes.
- **The owner's rename on the Customers page.** It keeps saving exactly what the
  owner types, with no correction and no line: it is the deliberate path, and
  the way to set any spelling at all.
- **Names with no number, order labels, staff names, dish names.** Only a
  customer's own name, typed with their number.
- **Choosing which customers get a name, or blocking a short one.** The 94
  one- and two-letter names look like a skipped field more than a name; that is
  a separate question about the counter, not about casing.
- **Correcting at the server.** The database keeps storing what the counter
  sends, so a biller's Keep as typed means what it says, and a build published
  before this change keeps working unchanged.
- **Spacing.** Double spaces inside a name are collapsed only in a name this
  change capitalises; no other name is touched for spacing.

## Change gate

- **`customer-names-capitalised`** (*NC*)
  - **On:** The counter saves a new customer's name typed all in small letters
    or all in capitals as Rahul Das, shows that before saving, and Keep as typed
    saves it as typed.
  - **Off:** The counter saves a new customer's name exactly as typed, as today.

**Off is today.** With the gate off the customer box runs its current code path
untouched: no line, and the name it sends is the trimmed text, as now. The
toggle point is the customer box alone; the outbox never reads the gate, and
the command it queues carries the same string field either way.

**What the on path persists, and Off living with it.** A capitalised name is
ordinary text in the fields the off path already writes and reads
(`customers.name`, `orders.customer_name`, `bills.customer_name`). Turned off,
names saved while it was on stay capitalised and every build reads them as it
reads any name. Round trip `none:`.

**The one-time correction is not behind the gate, and turning the gate off does
not undo it.** It changes 747 saved names through the owner's rename, which is
how the owner already corrects a name, and old builds read the result as they
read any name. It runs only on the owner's word, after a dry run reports its
counts, and its before-image is what undoes it (design D5).

## Durable documentation

Before archive: `docs/SCREENS.md` (the counter's customer entry: what is typed
and what is saved), `docs/DATA_MODEL.md` (the `customers.name` paragraph: a name
is saved capitalised unless typed in mixed case or kept as typed), and the
comment above the name field in `src/features/billing/customer-dialog.tsx`,
which records the 2026-09-19 decision this change revises and must say what
replaced it.

## Decisions taken with the owner, 2026-11-22

Recorded here because the implementing session will not have the conversation.
Reasons and rejected alternatives are in `design.md`.

1. **Names are capitalised word by word**: first letter of each word a capital,
   the rest small. Asked for by the owner after seeing the counts above.
2. **The counter must still be able to save a different casing on purpose**
   (owner, 2026-11-22). Hence: only entirely-lowercase and entirely-capital names
   are corrected, the correction is visible before saving, Keep as typed is one
   tap, and the owner's rename stays exact.
3. **Existing badly cased names are fixed too**, not only new ones.
