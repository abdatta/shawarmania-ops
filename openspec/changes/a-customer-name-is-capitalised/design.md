# Design: A Customer Name Is Capitalised

## Shape of the change

Three pieces, in this order:

1. **One rule**, a pure function in `src/domain/customer-name.ts`, used by the
   counter and by the one-time correction, so the two can never disagree.
2. **The counter's customer box**, behind `customer-names-capitalised`, shows
   what the rule would save and lets the biller keep what they typed.
3. **A one-time correction** of the saved names the rule matches, run as the
   owner through `customer_rename`, after the gate is released.

No database object changes except the gate's own `change_gates` row. No RLS
policy, no money arithmetic, no outbox shape.

## Decisions

### D1. The rule: only names no deliberate spelling takes

`capitalisedName(typed: string): string | null` returns the name to save
instead, or `null` when the name is to be saved as typed.

It returns a name only when **all** of these hold for the trimmed text:

- it has **three or more letters that have case** (`\p{Lu}` or `\p{Ll}`);
- **every** such letter is lowercase, or **every** one is uppercase.

The result: runs of whitespace become one space; every letter is lowercased; a
letter is then uppercased when it is the first character or follows a character
that is not a letter or a digit. That is Postgres `initcap`'s word boundary, so
`d'souza` → `D'Souza`, `a.kumar` → `A.Kumar`, `ram-prasad` → `Ram-Prasad`, and
`a8aaa` → `A8aaa`. A name in a script with no case (Bengali) has no cased
letters and is never touched.

Cases the unit tests pin, each with its reason:

| Typed | Saved | Why |
|---|---|---|
| `rahul das` | `Rahul Das` | all lowercase |
| `RAHUL DAS` | `Rahul Das` | all capitals |
| `  rahul   das ` | `Rahul Das` | spacing tidied only because it is capitalised |
| `MD Rahim` | as typed | mixed case is deliberate (owner, 2026-09-19) |
| `d'Souza` | as typed | mixed |
| `McKenzie` | as typed | mixed; `initcap` would make it `Mckenzie` |
| `RAJ kumar` | as typed | mixed |
| `AA`, `md`, `a.k` | as typed | fewer than three letters; likely initials |
| `SK ABDUL` | `Sk Abdul` | all capitals; the owner's own example spelling |
| `রাহুল` | as typed | no cased letters |

**Rejected: capitalise every name.** It mangles exactly the names the
2026-09-19 decision protected, and makes a deliberate spelling impossible,
which the owner ruled out.

**Rejected: a list of exceptions (`Mc`, `Mac`, `O'`, `MD`, `SK`).** It is never
complete, it guesses at other people's names, and mixed case already carries
the signal: a biller who typed `McKenzie` meant it.

### D2. The counter shows the correction and never interrupts typing

The field holds exactly what was typed, always. Under it, while
`capitalisedName(name)` returns a name, one line reads
`Saves as <capitalised>` with a **Keep as typed** button; after Keep as typed it
reads `Saves as typed` with **Capitalise**. Confirming sends the line's name:
`keepAsTyped ? name.trim() : capitalisedName(name) ?? name.trim()`.

The line renders only where the name field renders today (`labelField`: a new
number, or a matched customer with no saved name), in the same box, in
`text-sm text-content-muted` with the button as a small ghost button, so
nothing above it moves when it appears; its space is reserved inside the
existing `min-h` block if a layout shift shows on the tablet.

`keepAsTyped` is box state: false when the box opens, flipped only by the
buttons, kept while the box stays open even if the name is edited, and
forgotten when it closes.

**Rejected: rewrite the field as they type.** Mid-word the rule misfires
(`MD` alone is all capitals and would become `Md` before `Rahim` is typed),
and text changing under a biller's fingers is worse than a wrong case.

**Rejected: rewrite the field on blur.** On the tablet the box confirms with
Done straight from the field, so there is often no blur before saving, and a
silent rewrite gives no moment to object.

**Rejected: a confirm step ("Save as Rahul Das?").** It adds a tap to every new
customer to protect a rare case. The line costs nothing on the common path and
one tap on the rare one.

**Rejected: correct at the server.** A biller's Keep as typed would then be
overruled, the owner's ruling forbids that, and a database correction would be
a replaced function (`customer_resolve_for_sale` is called by every billing
function) for no gain the counter does not already give.

### D3. The owner's rename stays exact

`customer-card-dialog.tsx` keeps saving `renaming.trim()`. It is the
deliberate path and the escape hatch for every spelling the rule would get
wrong, including the correction's own (D5). No line there: the owner is
correcting a name on purpose.

### D4. Toggle point and offline

The toggle point is `useChangeGate('customer-names-capitalised')` in
`customer-dialog.tsx`, read from the page's frozen snapshot. Off: the component
renders and sends exactly what it does today, the old path untouched, not
rewritten to look the same.

The name is decided in the box, before `onChoose`, so everything downstream,
including the outbox, receives the same `name: string` it receives today. The
outbox never reads the gate. **Offline semantics are unchanged**: a sale rung
offline queues the name the box chose, and replays it as any name.

### D5. The one-time correction

Run once, by the agent, on the owner's word, after the gate has been released
and pulled (so new names stop arriving in one case before old ones are fixed).
It is a data correction, not a migration: migrations only add, and this is the
owner's own rename applied 747 times, which no migration may do and which the
owner may do at any time from the Customers page.

The route is the one used for earlier production repairs (memory: retroactive
drawer count repairs): the session pooler, one transaction, `set local
request.jwt.claims` to the owner's profile so `customer_rename(p_outlet,
p_customer, p_name)` runs as the owner, exactly as the Customers page would.
`app_customer_directory_outlets()` gives the owner every customer; `p_outlet` is
any outlet that served the customer.

1. **Discover, read-only.** Select every customer whose name the SQL pre-filter
   matches (`name = lower(name) or name = upper(name)`), compute
   `capitalisedName` in Node by importing `src/domain/customer-name.ts` (Node
   strips its types, as `scripts/paper-sales.mjs` does for `shared/*.ts`), and
   report counts only: how many would change, how many the rule leaves alone,
   and how many differ from Postgres `initcap` on the same rows (expected
   zero, apart from whitespace). No name or number is printed.
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
the retirement's contract migration.** It keeps every row as it is until
retirement, but it cannot tell a deliberate `RAJ` saved with Keep as typed from
an old careless one without a new column and a new create function, and it
would need the same formatting at every place a name is read (counter, owner
pages, campaigns, receipts), for weeks.

**Rejected: a migration with an emergency or lint-allow exit.** This is not an
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
- **Request budget** unchanged: the box makes no new request.

## Risks

- **A deliberate all-capitals name in the existing 747** (`MD` alone is two
  letters and safe, but a customer who wants `SANJAY` gets `Sanjay`). The
  before-image undoes it by customer id, and the owner's rename sets any
  spelling.
- **The line crowds the box on a small tablet.** It is one line inside an
  existing block; the browser test screenshots the box at the counter's
  viewport with the line showing.
