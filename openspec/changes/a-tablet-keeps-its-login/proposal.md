# Proposal: A Tablet Keeps Its Login

> **Model**: Opus · **Roadmap**: none (a correction to shipped behaviour) ·
> **Depends on**: #9 `counter-devices-and-offline`, #36
> `multiple-billing-devices`, #70 kitchen tablets, #75
> `a-release-can-be-switched-off` · **Gate**: on a set-up counter or kitchen
> tablet with `a-tablet-keeps-its-login` on, every address other than the
> tablet's own home (`/counter` or `/kitchen`), including `/sign-in`,
> `/activate` and any route added after this change, lands on that home, and
> no person's sign-in or activation can replace the tablet's session, proved by
> a route-matrix test that walks the live route table; a fresh setup is never
> signed out by the session check that runs while its proof is in flight; with
> the gate off, `/sign-in` and `/activate` on a tablet behave exactly as today;
> and the four-role demo walkthrough still walks.

## Why

Kalyani Cafe's counter laptop has been "losing its registration" and being set
up again under a new name: Kalyani Counter 2 (14 Oct), Cafe 2 twice (25 Oct),
Cafe 3 (30 Oct). The abandoned rows pile up on the Tablets list until someone
removes them. Every setup code was issued by Supratik from his own phone, away
from the shop.

Production's auth and request logs show the same sequence each time (read-only,
2026-10-31):

| 30 Oct, IST | On the counter laptop (one Windows Chrome, the shop's IP) |
|---|---|
| 11:54:20 | Opens as tablet **Cafe 2**: refreshes its session, reads its device row and shifts |
| 11:54:41 | **A staff member signs in with their own password** on that laptop |
| 11:54:57 | Marks their attendance |
| 11:55:14 | Signs out |
| 14:02 | The laptop holds no session, so a new tablet, **Cafe 3**, is set up with a fresh code |

25 Oct is the same: a staff password sign-in on the laptop at 12:02, sign-out at
12:33, a new tablet at 12:34. The old tablet's refresh token is still valid on
the server. The browser simply no longer holds it.

The cause is in the app, not the people:

- A browser has **one** session slot (`shawarmania.auth`). A person signing in
  replaces the tablet's session in it, and signing out empties it.
- The root and every role address already send a tablet to `/counter`. **`/sign-in`
  and `/activate` do not**, so a password form appears on a set-up tablet, which
  the spec already forbids: "No account password SHALL be accepted on a tablet
  at setup or at any time afterwards."
- The redirects that do exist are written into each screen one at a time. A
  screen added later, such as a forgotten-password page, starts unguarded unless
  someone remembers.

A second fault showed in the same logs. The first "Cafe 2" on 25 Oct signed in at
12:34:45 and was **signed out at 12:34:46**. Setup signs in and then proves the
session. The sign-in fires the app's session check at once. That check reads the
device row before the proof lands, finds no tablet and no person, treats it as a
deactivated account, and signs out. The admin removed that row and issued another
code.

## What changes

### A tablet only ever shows its own page

A set-up counter tablet opens the counter and pages beneath it. A set-up kitchen
tablet opens the kitchen and pages beneath it. Every other address takes the
tablet home. That includes `/sign-in`, `/activate`, `/counter/setup`, a role
address, a mistyped address, and any page added elsewhere later. A new page does
not need to opt out. It is out unless it lives under the tablet's home.

The counter can still grow. A future counter Expenses page placed at
`/counter/expenses` is open to the counter tablet with no change to this rule,
and closed to the kitchen tablet and to people.

The other direction already holds and stays: a person opening `/counter` or
`/kitchen` goes to their own shell, and a signed-out visitor goes to sign-in. A
counter tablet opening `/kitchen` goes to `/counter`, and a kitchen tablet
opening `/counter` goes to `/kitchen`.

### A person's sign-in cannot replace a tablet's session

Even if some future screen reaches the sign-in or activation code on a tablet,
that code refuses while the browser holds a tablet's session. Nothing is sent to
the server and the tablet stays a tablet. The message says where to go instead:

> This is a counter tablet. Sign in on your own phone.

### A fresh setup is not signed out by its own session check

While a setup is between "signed in" and "proved", the app's session check treats
an unreadable tablet row as "not known yet" rather than "deactivated". A tablet
whose setup has just succeeded opens the counter. A tablet removed by an admin is
still signed out at its next check, exactly as today.

### What staff do instead

Attendance is marked on each person's own phone. The counter laptop never asks
anybody for a password.

## Change gate

- **`a-tablet-keeps-its-login`** (*TK*)
  - **On:** A set-up tablet opens only its own counter or kitchen page, whatever address it is given, and nobody can sign in as a person on it.
  - **Off:** A set-up tablet can still open the sign-in and activation pages, and a person signing in there replaces the tablet's login.

**No gate for the setup race fix.** It corrects shipped behaviour that the spec
already describes ("the browser holds that device session") and must reach a
browser before it has ever saved a gate answer. A brand-new laptop boots with
every gate off, and a brand-new laptop is exactly what setup runs on. Its only
effect is that a setup which succeeded stays signed in. A revert undoes it
cleanly and it writes nothing.

## Non-goals

- **Recovering the abandoned tablets.** Their sessions cannot be handed back to
  the laptop. The owner removes Kalyani Counter 2 and the second Cafe 2 from the
  Tablets list by hand.
- **Tidying the Tablets list automatically.** Detecting that a laptop was set up
  twice would need a hardware identity the browser does not give.
- **A sign-out or "reset this tablet" control on the tablet.** Removal stays an
  admin action, as `counter-root.tsx` explains.
- **Changing how a person signs in on their own phone.**
- **Attendance on the counter.** A shared-device check-in is a separate
  decision, and the evidence does not ask for one. On 30 Oct the staff member's
  own Android phone was open and signed in three seconds after the laptop
  sign-in, read their attendance, and made no failed check-in attempt. At 14:02
  the same phone confirmed the shift that opened Cafe 3, which a shift
  requires. The phone was in hand throughout.

## Docs to update before archive

- `docs/SCREENS.md`: the counter and kitchen tablets open only their own page,
  whatever the address.
- `docs/SECURITY_AND_PRIVACY.md`: no person's session can replace a tablet's, and
  why one session slot makes that matter.
- `docs/ARCHITECTURE.md`: the tablet boundary sits once at the top of the real
  route tree, and is deny by default.
- `docs/OPERATIONS.md`: a laptop that "lost its registration" — check for a staff
  sign-in on it before issuing a new code, and remove the abandoned row.
