# Design: A Customer Name Is Capitalised

## Shape of the change

Three pieces, in this order:

1. **One rule**, pure functions in `src/domain/customer-name.ts`, used by the
   counter and by the one-time correction, so the two can never disagree.
2. **The counter's name field**, behind `customer-names-capitalised`, applies
   the rule to each word in the field as the word is finished, and stops for
   the rest of the box once the biller edits a word it corrected.
3. **A one-time correction** of the saved names the rule matches, run as the
   owner through `customer_rename`, after the gate is released.

No database object changes except the gate's own `change_gates` row. No RLS
policy, no money arithmetic, no outbox shape.

## Decisions

### D1. The rule works word by word

`capitalisedWord(word: string): string` returns the word to show instead, or
the same word when it is to be left alone. A word is a run of characters
between spaces. The word is capitalised when **any one** of these holds:

- every cased letter (`\p{Lu}`/`\p{Ll}`) in it is lowercase (`rahul`, `md`, `a`);
- every cased letter is uppercase **and** it has three or more of them
  (`RAHUL`, `SANJAY`; not `MD`, `SK`, `AK`, which are usually initials);
- it is one lowercase letter followed by two or more uppercase ones, the
  caps-lock shape (`rAHUL`).

Otherwise it is left alone: mixed case (`McKenzie`, `d'Souza`, `DSouza`,
`MOhan`) is taken as meant, and a word with no cased letters (Bengali, digits)
has nothing to change.

Capitalising: every letter lowercased, then a letter uppercased when it is the
first character of the word or follows a character that is not a letter or a
digit, which is Postgres `initcap`'s boundary: `d'souza` → `D'Souza`,
`a.kumar` → `A.Kumar`, `ram-prasad` → `Ram-Prasad`, `a8aaa` → `A8aaa`. **A word
whose case mapping would change its length** (`ß`, dotted `İ`) is left alone, so
a correction never moves the cursor (D2).

`capitalisedName(name: string): string` applies `capitalisedWord` to every word,
trims, and collapses runs of whitespace to one space. It is what the one-time
correction uses, and what the box applies to the last word on confirm.

Measured against production on 2026-11-23 (2,142 names, counts only, no name
printed):

| Saved names | Count | Share |
|---|---|---|
| Already read right (incl. 72 one- or two-letter names like `AA`) | 1,415 | 66.1% |
| Corrected by the rule: a lowercase word (534), an all-capitals word (186), a caps-lock word (5) | 725 | 33.8% |
| Oddly cased, left alone (`MOhan`-like shapes) | 3 | 0.1% |

Cases the unit tests pin:

| Typed | Shown | Why |
|---|---|---|
| `rahul das` | `Rahul Das` | lowercase words |
| `RAHUL DAS` | `Rahul Das` | all-capitals words |
| `rAHUL` | `Rahul` | caps-lock word |
| `MD rahim` | `MD Rahim` | `MD` is two capitals, likely initials |
| `md rahim` | `Md Rahim` | lowercase words, however short |
| `RAJ kumar` | `Raj Kumar` | word by word |
| `McKenzie`, `d'Souza`, `MOhan` | as typed | mixed case is meant |
| `SK ABDUL` | `SK Abdul` | |
| `d'souza` | `D'Souza` | `initcap` boundary |
| `রাহুল` | as typed | no cased letters |

**Rejected: a rule over the whole name** (correct only when the whole name is in
one case; the first draft). The box corrects word by word while the biller types,
so after the first word is corrected the name is already mixed case and a
whole-name rule would refuse the second. It also left `RAJ kumar` alone.

**Rejected: a list of exceptions (`Mc`, `Mac`, `O'`).** Never complete, and a
guess at other people's names. Mixed case already carries the signal.

### D2. The field corrects itself as each word is finished

The field shows the corrected text itself. There is no extra line or button
(owner, 2026-11-23, refusing the first draft's `Saves as … / Keep as typed`).

**When a word is finished**, the field replaces that word with
`capitalisedWord` of what the biller typed for it:

- **a space** is typed after it: the word before the space;
- **a pause**: about a second with no input, the word the cursor is at the end
  of. Tune the delay on the counter tablet; start at 900 ms;
- **confirming** the box (Done, Enter or the confirm button): every word, through
  `capitalisedName`, which also trims and collapses spaces.

A correction is judged from **what was typed for the word**, not from what the
field shows: the field remembers, for each word it has corrected, the letters
as typed, and if the biller carries on typing **at the end** of that word, the
word is judged again as a whole when it is next finished. So `RAH` (pause)
reads `Rah`, then `UL` makes `RAHUL` typed and `Rahul` shown, never `RahUL`.

**The cursor never moves** (owner, 2026-11-23: "the worst experience when
suddenly the cursor moves and … it is getting now inserted somewhere else").
This is the field's first requirement, ahead of correcting anything: **when a
correction cannot be applied without any chance of moving the cursor, it is
skipped**, and the word is left as typed. A missed capital is a small thing; a
letter landing in the wrong place is not. Each way a cursor jumps in a
corrected input, and the guard against it:

1. **The text changes length.** A correction changes case only, letter for
   letter, so every character keeps its index. A word whose case mapping would
   change its length (`ß`, dotted `İ`) is left alone (D1). Spacing is tidied
   only in the value sent on confirm, never in the field.
2. **React resets the caret on a programmatic value.** Setting a controlled
   input's value from code puts the caret at the end in some browsers. Read
   `selectionStart`, `selectionEnd` and `selectionDirection` before the change
   and restore them in the same frame (`useLayoutEffect`, before paint), only
   while the field has focus.
3. **The biller typed between the decision and the change.** The pause timer
   and the space handler decide on a value; a keystroke can land before the
   change does. Apply a correction only if the field's value is still exactly
   the value it was worked out from, and otherwise drop it; the next finished
   word decides again.
4. **The keyboard is composing.** Android keyboards hold the word being typed
   as a composition and commit it later; changing the value mid-composition
   makes the keyboard re-insert its word at its own idea of the cursor, which
   is the "inserted somewhere else" failure. Never correct between
   `compositionstart` and `compositionend`, and never correct the word the
   keyboard is composing; it is corrected at its next finish.
5. **The cursor is not at the end.** If the biller has put the cursor inside the
   text (to fix something earlier), the pause correction does nothing: it acts
   only when the cursor is at the end of the word it would change, with no
   selection. A space typed mid-text corrects the word before it, which is
   behind the cursor, so nothing after the cursor shifts.

These are tested as an invariant, not only by example (task 3.1): a generated
run of keystrokes, pauses, cursor moves, compositions and backspaces is typed
into the field, and after every step the cursor and selection must be exactly
where they would be with correction off, and the text must equal the
uncorrected text ignoring case.

**Going back turns it off.** The field records which words (by position) it
has corrected. An input that deletes any character of a corrected word, or
inserts anywhere in it but at its end, sets `stopped`, and from then on the box
corrects nothing, confirm included, and sends exactly what the field shows,
trimmed. Typing on at the end of a corrected word continues it (above).
Deleting the space after a corrected word does not count; the next backspace,
into the word, does. Editing a word the box has not corrected (a typo fixed
mid-word) does not stop anything. Moving the cursor alone does not. `stopped`
lives as long as the box is open and is forgotten when it closes.

A name the box opens with (the order label offered as a name) is treated as
typed: confirm capitalises it unless the biller edits a word the box corrected.
A paste is typing: its words are corrected at the next pause or on confirm.

**Rejected: correct on every keystroke.** Mid-word the rule misfires (`MD` is
initials only until the next letter shows it is `MDR…`), and letters changing
under a biller's fingers are worse than a wrong case.

**Rejected: the `Saves as … / Keep as typed` line** (the first draft). Refused
by the owner on 2026-11-23 as new UI the counter does not need.

**Rejected: correct only on confirm.** The biller would never see the change
before it is saved, so going back to a casing would be impossible.

**Rejected: correct at the server.** A biller who went back to a casing would be
overruled, and a database correction would be a replaced function
(`customer_resolve_for_sale` is called by every billing function).

### D3. The owner's rename stays exact

`customer-card-dialog.tsx` keeps saving `renaming.trim()`, with no correction.
It is the deliberate path and the way to set any spelling the rule gets wrong,
including the one-time correction's (D5).

### D4. Toggle point and offline

The toggle point is `useChangeGate('customer-names-capitalised')` in
`customer-dialog.tsx`, read from the page's frozen snapshot. Off: the field's
`onChange` is today's `setName(event.target.value)` and confirm sends
`name.trim()`, the old path untouched, not rewritten to look the same. The
correction logic lives in a small hook (`useCapitalisingName`) the on path
calls, so the off path's code is not edited.

The name is decided in the box, before `onChoose`, so everything downstream,
including the outbox, receives the same `name: string` it receives today. The
outbox never reads the gate. **Offline semantics are unchanged**: a sale rung
offline queues the name the box chose, and replays it as any name.

### D5. The one-time correction

Run once, by the agent, on the owner's word, after the gate has been released
and pulled (so new names stop arriving in one case before old ones are fixed).
It is a data correction, not a migration: migrations only add, and this is the
owner's own rename applied some 725 times, which no migration may do and which
the owner may do at any time from the Customers page.

The route is the one used for earlier production repairs (memory: retroactive
drawer count repairs): the session pooler, one transaction, `set local
request.jwt.claims` to the owner's profile so `customer_rename(p_outlet,
p_customer, p_name)` runs as the owner, exactly as the Customers page would.
`app_customer_directory_outlets()` gives the owner every customer; `p_outlet` is
any outlet that served the customer.

1. **Discover, read-only.** Read every saved name, compute `capitalisedName` in
   Node by importing `src/domain/customer-name.ts` (Node strips its types, as
   `scripts/paper-sales.mjs` does for `shared/*.ts`), and report counts only:
   how many change, by kind, and how many are left oddly cased. No name or
   number is printed.
2. **Save the before-image** of every row to be changed (customer id, old name,
   new name) to a file **outside the repository**, never committed: it is PII.
3. **Dry run**: the transaction with every rename, then `rollback`, asserting
   the changed count equals step 1's.
4. **Commit**, on the owner's yes with the count in front of them.
5. **Undo** (whole or by customer id) renames back to the old name only where
   the current name still equals the corrected one, so a later rename by the
   owner is never overwritten.

Bills and orders are untouched: `customer_rename` changes the saved profile
only, as its requirement already says.

**Rejected: display-time capitalisation behind the gate, written to the rows by
the retirement's contract migration.** It cannot tell a casing a biller went back
to from an old careless one without a new column and a new create function, and
needs the same formatting wherever a name is read (counter, owner pages,
campaigns, receipts), for weeks.

**Rejected: a migration with an emergency or lint-allow exit.** Not an
emergency, and the owner's rename already exists for exactly this.

**Rejected: a committed script.** It runs once. The procedure above is the
record; the before-image is the undo.

## Release and version skew

- **`change_gates` row** (new insert, the only migration). Nothing a published
  build reads changes; an older build does not know the key and treats it as
  off.
- **`customers`, `orders`, `bills`.** No column, constraint, trigger or function
  changes. A build published before this change keeps sending names as typed,
  and the server stores them as today, so during skew some new names arrive in
  one case; the owner's rename fixes any that matter.
- **Gate off after on.** Names saved capitalised stay capitalised: ordinary text
  every build reads. Nothing is queued or stored in a new shape, so nothing can
  be stranded. Round trip `none:`, no round-trip test needed.
- **The correction** is outside the gate; its undo is the before-image (D5).
- **Retirement** deletes the off path and tombstones the key. There is nothing
  for a contract migration to drop.
- **Request budget** unchanged: the field makes no request.

## Risks

- **A deliberate all-capitals word among the saved names** (`SANJAY` becomes
  `Sanjay`). The before-image undoes it by customer id, and the owner's rename
  sets any spelling.
- **A biller does not notice a correction and wanted the other casing.** The
  owner's rename fixes the profile; this is the trade the owner chose over an
  extra line.
- **Keyboard quirks.** Android composition and autocorrect, iOS predictive text,
  and the tablet's own `autoCapitalize="words"` all act on the same field. The
  browser test covers a hardware-style keyboard; the owner tries it on the
  counter tablet in demo before it goes live (task 3.6), and **any cursor jump
  seen there is a blocker, not a tuning note**: the fix is to skip more
  corrections, never to accept the jump. If the tablet's keyboard cannot be made
  safe, the pause correction goes and words are corrected only at a space and on
  confirm.
