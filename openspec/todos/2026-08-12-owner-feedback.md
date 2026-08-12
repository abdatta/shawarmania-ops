# Owner Feedback — Kalyani Counter, 12 Aug 2026

This page tracks only the things the owner noticed while setting up billing at
the Kalyani outlet on 12 Aug 2026. It is **kept separate on purpose** — it does
not go in [`README.md`](./README.md)'s big table, so these seven items don't
get lost in the full backlog.

Each item below is its own file, written in plain, simple language on purpose.
When one of these is ready to actually build, turn it into a real change with
`/opsx:propose` (or `/quickfix` if it's small), same as anything else.

## The list

**Ranked smallest task to biggest.** The `S`/`M`/`L`/`XL` column is a rough
guess at how much work each one is — not how important it is. The `L` and
`XL` ones are big enough that we should do another pass of analysis on them
before actually building anything.

| # | Item | Area | Size |
| --- | --- | --- | --- |
| 1 | [The "Awaiting Activation" Label Lies](./awaiting-activation-label-lies.md) | Staff / Roles | S |
| 2 | [You Can't Click Your Way to the Counter Setup Page](./counter-setup-page-has-no-link.md) | Navigation | S |
| 3 | [Let Me Drag to Resize the Last Two Counter Columns](./drag-resize-counter-columns.md) | Counter / Design | S |
| 4 | [Promoting a Staff Member Can Accidentally Lock Them Out](./promoting-staff-can-lock-them-out.md) | Staff / Roles | M |
| 5 | [The App Asks for a Code Before Checking If the Person Is Even Allowed](./code-request-before-eligibility-check.md) | Counter / Billing | L |
| 6 | [Marking a Bill "Paid" Removes It From the Kitchen List Too Soon](./paid-removes-order-from-kitchen-too-soon.md) | Billing | XL |
| 7 | [The Owner Can't See the Real Billing Counter From Home](./owner-cant-see-real-counter-remotely.md) | Owner console / Demo | XL |

### 1. The "Awaiting Activation" Label Lies — `S`
Arpita's account shows "Awaiting Activation" even though she's actively
working. The label only checks for a leftover unused invite code, not
whether she's ever actually logged in — and nothing will ever use up that
spare code, so it's stuck this way.

### 2. You Can't Click Your Way to the Counter Setup Page — `S`
The tablet's setup page can only be reached by typing the address in by
hand — which doesn't even work once the app is installed, since installed
apps have no address bar. Nothing in the app links to it, and a "Shift" tab
that should help got switched off by accident.

### 3. Let Me Drag to Resize the Last Two Counter Columns — `S`
The owner wants to drag-resize the bill and activity columns on the counter
screen. They're locked to equal width on purpose right now, so the menu
column never gets squeezed off screen — changing this just needs a decision
on whether to relax that rule, and by how much.

### 4. Promoting a Staff Member Can Accidentally Lock Them Out — `M`
There's no way to add a second role to someone already working at an
outlet — you have to end their current role first. Ending it shows a
checkbox, checked by default, that also logs them out entirely, turning a
routine promotion into an accidental deactivation.

### 5. The App Asks for a Code Before Checking If the Person Is Even Allowed — `L`
Typing anyone's name on the counter tablet sends them a real code-entry
request on their own phone, even if they aren't allowed to bill. The app only
checks eligibility after they type the code back, so by the time anyone finds
out, the person has already been bothered for nothing.

### 6. Marking a Bill "Paid" Removes It From the Kitchen List Too Soon — `XL`
Customers can pay at any point — ordering, cooking, or after pickup — but
marking an order "paid" also yanks it off the kitchen's active list right
away. There's no way to separately track "still cooking" from "paid."
Fixing it touches the core order model and money, so it needs real design
work first.

### 7. The Owner Can't See the Real Billing Counter From Home — `XL`
The owner wants to open the real billing counter from their own phone, using
a one-time snapshot of real data in a safe practice mode. Today's practice
mode only ever uses made-up data, and the real counter and the practice
counter are actually built differently under the hood — so this is a real
feature to design, not a small tweak.
