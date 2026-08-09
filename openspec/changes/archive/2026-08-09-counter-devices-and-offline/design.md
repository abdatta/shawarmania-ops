## Context

The schema already anticipates machine Auth users in `counter_devices`, but the
current real session path assumes every Auth user owns a profile and an
assignment, so seed tablets masquerade as people. The demo counter opens shifts
with a shared PIN, which attributes work to nobody in particular.

Launch targets one active tablet at each outlet, both of which physically exist.

**The durable local operation store moved to #33 on 2026-08-09.** It would have
been built here against a payload shape nothing had defined yet; the command
contract defines that shape, so the queue that carries it belongs there.

The owner has chosen a stricter sign-in story than the original proposal
assumed: **no password is ever typed on the shared tablet**, and a shift opens
only when the named person approves it on their own phone.

## Goals / Non-Goals

**Goals:**

- Separate machine identity from people, profiles, and assignments.
- Open a shift through a two-device handshake that never exposes a password on
  shared hardware and always names an accountable person.
- Let that person end their shift from their own phone.
- Make Biller a single assignment that includes Employee attendance behaviour.
- Enforce one active tablet per outlet, and immediate removal, in Postgres.

**Non-Goals:**

- Sending real billing commands or making billing live.
- More than one active tablet per outlet.
- The local operation store, which is #33's.
- Any fallback approver, push notifications, tablet attendance, inactivity
  auto-lock, or emergency personal-device billing.

## Vocabulary

Fixed here so four changes and the schema use one word each.

| Concept | Word used everywhere | Rejected |
|---|---|---|
| The person is on the counter today | **shift** | grant, session, operator token |
| Linking a tablet to an outlet | **set up** (`enrol` in specs only) | enrol, register, provision |
| Unlinking a tablet, permanently | **remove** | revoke, deactivate, disable |
| The tablet's own credential | **device session** | machine principal, machine credential |
| A write that will not save and needs a human | **needs attention** | quarantine |
| A write that has not reached the server yet | **not sent yet** | provisional, pending reference |

## Decisions

### A tablet is a machine principal, never a synthetic person

The machine Auth user maps only to `counter_devices.id`. Session loading checks
that row and its removal state before attempting the human profile path. It
receives no profile and no assignment.

Keeping synthetic Biller people was rejected because profiles and assignments are
the durable people model, and a synthetic person inherits human behaviour by
accident rather than by decision.

### Setup uses a one-time code, so no password reaches the tablet

The admin generates a **setup code** on their own phone, from the Tablets
surface. The code is stored only as a hash, shown once, expires quickly, and is
single-use. On the tablet, an unauthenticated setup screen accepts the code and
the privileged function re-derives the issuing admin's authority from the stored
record, enforces one active tablet for the outlet, creates the machine Auth
identity and the tablet row, and returns the material that establishes the device
session.

This deliberately mirrors `account_invites`, which is already built, already
proven and already understood by whoever operates this shop. The original design
had the admin sign in on the tablet and then destroyed that session; that was
rejected because it types a personal password on the exact hardware this change
exists to keep passwords away from, and because "we delete it immediately after"
is a promise rather than a boundary.

A local "registered" flag with no server credential was rejected because it is a
UI preference, not a security boundary.

### A shift opens through a two-device handshake, confirmed by a code

Opening the counter is a handshake between the tablet and the operator's own
phone, and the tablet's half is a code the phone has to be told:

1. The tablet submits a **shift request** naming a username and nothing else. The
   tablet holds no secret belonging to the person and learns nothing about them
   from the response.
2. The tablet displays a **four-digit confirmation code**, returned by the server
   when the request was created.
3. The named person, already signed in on their own phone, sees a card on their
   home screen stating the outlet, the tablet and the time, asking for the code
   shown on the tablet, and offering to reject the request outright.
4. They enter the code on their phone. The server verifies it and creates the shift.
5. The tablet, watching its own request, notices and enters billing without
   anybody touching it again.

**A plain Approve button was rejected**, and this is the substantive decision here.
A request that is approved by one tap is approved by habit: an attacker who can
reach the tablet submits requests repeatedly until the person taps through one
without reading it. Requiring the code makes approval impossible unless the person
can physically see the tablet, which is the property actually wanted, since the
whole premise is that they are standing at the counter. This is the same reasoning
behind number matching at GitHub and Microsoft.

The result is that possession of the person's phone is required and their password
never exists on shared hardware. **This is one factor, not two, and the proposal
says so plainly rather than calling it two-factor.** The factor it uses is stronger
than the one it replaces, because an observer behind the counter can no longer
collect a password by watching.

Verifying the password on the tablet as well was rejected by the owner. Minting a
role-bearing JWT was rejected because authority does not belong in tokens.

### The code is four digits, and that is not an oversight

The code does no work against guessing, because entering it at all requires an
authenticated session belonging to the named person on their own device. Its only
job is to prove the person can see the tablet. Length therefore buys nothing but
slower typing during a rush, so it is four digits, displayed large enough to read
across a counter, and this paragraph exists so nobody later "hardens" it to six.

It is stored hashed, is consumed by its first correct use, dies with its request,
and three wrong entries destroy the request so a typo loop ends in a fresh start
rather than an indefinite retry.

### The request is enumeration-safe, short-lived, single-use, and cancellable

An unknown username produces exactly the same code display, the same waiting
state and the same timeout as a real one that is never confirmed, so the tablet
cannot be used to discover who works here. A request expires in two minutes, is
consumed by the first confirmation or rejection, and a tablet holds at most one
open request at a time, which bounds how fast requests can be aimed at anybody's
phone.

The tablet can cancel its own pending request at any time, for the ordinary case
of a mistyped name. Cancelling withdraws the card from the person's phone rather
than leaving it there to be puzzled over, which means the phone must observe the
request's disappearance and not only its arrival.

Rejecting a request is recorded with its time, because a rejection is somebody
saying "that was not me" and it is the one signal worth being able to look back at.

### The phone learns about it live, over the channel it already trusts

Delivery is Supabase Realtime on a row-level-security-scoped channel: the person
receives changes to shift requests naming them, and to shifts they hold, and
nothing else. If Realtime is unavailable the surface still resolves on load and
on focus, so the feature degrades to "open the app and it is there" rather than
failing.

Web Push was rejected. It needs a push service, keys, service-worker handling and
an installed app on iOS, and it optimises for approving while not looking at the
counter, which is the one case this feature exists to prevent.

### There is no fallback approver, and the cost is written down

Only the named person can approve their own shift. A flat battery, a phone left
at home, or no mobile data means that person cannot open the counter and somebody
else must. An FA or SA approving on another person's behalf was rejected by the
owner; the honest trade is recorded in `docs/LIMITATIONS.md`, not softened.

The recovery path when a phone is lost is the one that already exists: an admin
deactivates the account, which ends every session it holds, and issues a fresh
activation link.

**The safety valve is that the code can be read out loud**, and that is a
property rather than a leak. Somebody at the counter types the owner's username,
phones them, reads the four digits to them, and the owner taps them in from
wherever they are. Nothing secret changes hands: the code lives on the tablet's
screen, belongs to that one request, and dies with it. What it costs is that
every bill that evening is attributed to the owner, which is visible and correct.

This is worth stating plainly rather than treating as a hole. The code was never
meant to stop a person who deliberately decides to open a counter in their own
name after a conversation. It stops the thing that actually goes wrong: a card
appearing on a phone and being tapped through out of habit.

### A shift can be ended from the phone that opened it

The person's home surface shows any live shift they hold, with the outlet, the
tablet and when it opened, and one action that ends it. Ending is a server-side
state change; the tablet discovers it at its next request and returns to the
shift-request screen without losing anything already committed locally.

This is deliberately not a remote wipe. Locally accepted work stays exactly where
it is and continues to drain, because it is money that was already taken.

### The shift expires at cutover; the tablet setup does not

The shift stores outlet, tablet, operator, opened time, explicit business date,
and expiry derived from that outlet's next cutover. New commands require the
shift to be live at their client creation time. At cutoff the tablet returns to
the shift-request screen. Pending commands keep their original shift reference
and may drain later.

Automatic same-operator rollover was rejected because it defeats daily
reauthentication. Removing the tablet at every cutoff was rejected because setup
describes the physical tablet, not the person using it that evening.

### One active tablet per outlet is a database invariant for launch

A partial unique constraint permits at most one `counter_devices` row without a
removal timestamp for each outlet. Replacing a tablet removes the old one first.
Removal is permanent and there is no paused state, by decision: a paused tablet
is a security question that a removed one is not, and re-setup costs one code.

### The tablet may record an expense, and the shift says who did

`counter-expenses` and `staff-expenses` went live in #38, so the Biller shell now
carries a live Expenses surface that this change would otherwise strand behind a
billing-only tablet. The owner's decision is that the tablet keeps it, because the
drawer is at the counter and the person spending is often the person billing.

The policy on `manual_ledger_expenses` therefore gains one branch: a device
session may insert an expense for its own tablet's outlet **only while it holds a
live shift**, and the row is attributed to that shift's operator, taken from the
shift row rather than from the request body. Nothing else the tablet can reach
widens. This is the one policy in this change where over-permission would be
silent, so it ships with its own DB test asserting both the accept and the four
refusals (no live shift, another outlet, a past business date, a different
operator named in the body).

## Risks / Trade-offs

- **The phone is now the only factor** → a lost or dead phone stops that person
  billing, and a stolen unlocked phone can approve. Mitigated only by immediate
  account deactivation, which already exists. Stated in `docs/LIMITATIONS.md`.
- **Realtime is new to this stack** → it is Supabase's own channel rather than a
  new vendor, it is scoped by RLS, and every surface resolves correctly without it.
- **Setup codes are a new secret** → hashed at rest, shown once, short expiry,
  single use, and unreadable by every client role, exactly as `account_invites`.
- **Auth user creation and Postgres setup cannot share one transaction** →
  privileged cleanup makes failed attempts inactive and retry safe.
- **One-tablet constraint delays an easy spare counter** → server contracts stay
  concurrency-safe and #35 removes the constraint without touching money history.
- **A tablet reports its own unsent count** → the Tablets surface says last
  reported rather than claiming a current figure, and #33 is what makes the
  number non-zero.

## Migration Plan

1. Add tablet, shift-request and shift schema, the one-tablet invariant, and the
   privileged setup, request, approve, reject and end functions.
2. Add the `manual_ledger_expenses` device-session branch with its DB test.
3. Remove synthetic device profiles and assignments from the seed, and adapt
   session loading to resolve a device session before the human profile path.
4. Add Biller hierarchy helpers, interpreting existing Biller assignments as
   Employee-capable, migrating no human data.
5. Add the Counter shell, Tablets surface and the three home approval surfaces,
   behind non-live gates.
6. Set up synthetic test tablets through the real function and run auth and RLS tests.

Rollback removes newly set-up tablets, restores the prior gates, and deletes empty
shift rows. Do not roll back by recreating fake people once real device
credentials exist; remove and set those tablets up again instead.

## Open Questions

None.
