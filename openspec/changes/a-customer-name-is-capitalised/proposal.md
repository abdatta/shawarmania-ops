# Proposal: A Customer Name Is Capitalised

> **Model**: Opus · **Kind**: correction to shipped behaviour, not a roadmap
> change (no row, no number) · **Depends on**: #56 `a-customer-is-a-phone-number`,
> #75 `a-release-can-be-switched-off` · **Gate**: with
> `customer-names-capitalised` on, the name box at the counter capitalises each
> word of a new customer's name in the box itself as the biller finishes it
> (`rahul das` and `RAHUL DAS` read `Rahul Das` before they are saved), with no
> new line or button; a word typed in mixed case (`McKenzie`, `d'Souza`) and an
> all-capitals word of one or two letters (`MD`, `SK`) are left as typed; once
> the biller deletes into or edits a word the box corrected, the box corrects
> nothing more in that name and saves exactly what it shows; with the gate off
> the counter is exactly as today; the saved names the same rule would correct
> (725 on 2026-11-23) are corrected once, through the owner's own rename, with
> every bill's name left as it was, and the correction can be undone from its
> saved before-image

## Why

Read from production on 2026-11-23: of 2,142 saved customers, **725 (33.8%)
have a word in one case that should be capitalised**: 534 a lowercase word, 186
an all-capitals word, 5 a caps-lock word (`rAHUL`). 1,415 (66.1%) already read
right, and 3 (0.1%) are oddly cased in a way the rule cannot judge (`MOhan`) and
are left alone. A third of the directory reads wrongly wherever a name is shown:
the counter's match card, the owner's Customers page, Gold members, and the name
a campaign greets a customer by.

The cause is deliberate. On 2026-09-19 the owner chose that the counter save a
name **exactly as typed**, because title-casing in code would mangle the names
the counter actually serves (`Sk Abdul`, `MD Rahim`, initials, `d'Souza`), and
the first name saved is the only one, since a till never rewrites a profile.
The tablet keyboard's `autoCapitalize="words"` was meant to make ordinary typing
come out right. It does not: a physical keyboard, a paste, caps lock and a
biller who simply types in small letters all ignore it.

The owner now wants names capitalised (2026-11-22), **and kept the reason the
old decision existed**: a biller who means a different casing must still be able
to type it. On 2026-11-23 the owner settled how: the box corrects itself as the
biller types, the way a phone keyboard does, and going back to edit a corrected
word turns the correction off for that name. No extra line, no extra button.

## What changes

**At the counter (behind the gate).** In the customer box, while a name is
being typed for a new number, each word is checked **when it is finished**: a
space after it, a pause of about a second, or confirming the box. A word typed
all in small letters, all in capitals (three or more letters), or with caps lock
on (`rAHUL`) is capitalised **in the box**, where the biller can see it:

```
typed:   r a h u l ␣ d a s  (pause)
box:     rahul → Rahul␣ → Rahul das → Rahul Das
```

A word typed in mixed case (`McKenzie`, `d'Souza`, `DSouza`) is taken as meant
and left alone, and so is an all-capitals word of one or two letters (`MD`,
`SK`, `AK`), which is usually initials. So `MD rahim` reads `MD Rahim`. A word
in a script with no capitals (Bengali) is never touched. Typing is never
interrupted: a word still being typed is not touched until it is finished, and
a correction never moves the cursor.

**Going back turns it off.** Once the biller deletes into, or types inside, a
word the box has corrected, the box corrects nothing more until it closes, and
saves exactly what it shows. To keep `SANJAY`, the biller backspaces over the
`anjay` the box made and types `ANJAY` again. Fixing a typo in a word the box has
not yet corrected does not turn it off.

The name saved is the name in the box, and the same name goes onto the order and
bill being rung, as it already does. Nothing else at the counter changes: a
returning customer's saved name is shown and used as it is, and the saved
profile is still never rewritten from a till.

**Once, for the names already saved.** After the gate has been released, the
saved names the same rule would correct (725 on 2026-11-23) are corrected,
through the owner's existing rename (the correction the Customers page makes),
run as the owner. Each customer's saved profile changes; **every bill and order
keeps the name it was rung under**, as a rename always has. The old names are
saved first, outside the repository, so the correction can be undone name by
name for any that the owner finds were meant as typed. The 3 names the rule
cannot judge are left alone; the owner can correct them, and any other, on the
Customers page, which saves exactly what is typed.

## Non-goals

- **Past bills and orders.** Their `customer_name` is history, snapshotted at the
  sale, and stays as it was rung. No receipt changes.
- **The owner's rename on the Customers page.** It keeps saving exactly what the
  owner types, with no correction: it is the deliberate path, and the way to set
  any spelling at all.
- **Names with no number, order labels, staff names, dish names.** Only a
  customer's own name, typed with their number.
- **Short names.** 99 saved names (4.6%) have only one or two letters (`AA`).
  They look like a skipped field more than a name; that is a separate question
  about the counter, not about casing. Their casing follows the same rule (`aa`
  becomes `Aa`, `AA` stays).
- **Correcting at the server.** The database keeps storing what the counter
  sends, so a biller who goes back to a casing gets it, and a build published
  before this change keeps working unchanged.
- **Spacing.** Double spaces are collapsed only in a name this change corrects,
  and only when it is saved, never while it is being typed.

## Change gate

- **`customer-names-capitalised`** (*NC*)
  - **On:** The counter capitalises a new customer's name in the box as it is
    typed, and stops for that name once the biller edits a word it corrected.
  - **Off:** The counter saves a new customer's name exactly as typed, as today.

**Off is today.** With the gate off the customer box runs its current code path
untouched, and the name it sends is the trimmed text, as now. The toggle point
is the customer box alone; the outbox never reads the gate, and the command it
queues carries the same string field either way.

**What the on path persists, and Off living with it.** A capitalised name is
ordinary text in the fields the off path already writes and reads
(`customers.name`, `orders.customer_name`, `bills.customer_name`). Turned off,
names saved while it was on stay capitalised and every build reads them as it
reads any name. Round trip `none:`.

**The one-time correction is not behind the gate, and turning the gate off does
not undo it.** It changes the matched saved names through the owner's rename,
which is how the owner already corrects a name, and old builds read the result
as they read any name. It runs only on the owner's word, after a dry run reports
its counts, and its before-image is what undoes it (design D5).

## Durable documentation

Before archive: `docs/SCREENS.md` (the counter's customer entry: what is typed
and what is saved), `docs/DATA_MODEL.md` (the `customers.name` paragraph: a name
is saved capitalised word by word unless typed in mixed case or edited back),
and the comment above the name field in
`src/features/billing/customer-dialog.tsx`, which records the 2026-09-19
decision this change revises and must say what replaced it.

## Decisions taken with the owner

Recorded here because the implementing session will not have the conversation.
Reasons and rejected alternatives are in `design.md`.

1. **Names are capitalised word by word**: first letter of each word a capital,
   the rest small (2026-11-22, after seeing the counts).
2. **The counter must still be able to save a different casing on purpose**
   (2026-11-22).
3. **Existing badly cased names are fixed too**, not only new ones (2026-11-22).
4. **No new UI** (2026-11-23). An earlier draft showed `Saves as Rahul Das` under
   the box with a **Keep as typed** button; the owner refused it. The box
   corrects itself as each word is finished, and **editing a corrected word
   turns the correction off for that name**: the owner's own description of the
   experience they want.
5. **A correction never moves the cursor** (2026-11-23), and nothing the biller
   types ever lands anywhere but where they were typing. This outranks
   correcting: a correction that cannot guarantee it is skipped, and a cursor
   jump seen on the counter tablet blocks the change (design D2).
