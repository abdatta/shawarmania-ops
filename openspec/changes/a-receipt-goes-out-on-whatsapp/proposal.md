# Proposal: a-receipt-goes-out-on-whatsapp

> **Model**: GPT-5.6 Sol · **Wave**: F · **Depends on**: #54, #56 · **Gate**: on a bill that carries a customer's number, the owner or a franchise admin taps **Send receipt** and WhatsApp opens on that number's chat with the bill's message and receipt link already typed, needing only Send; a bill with no number, or one that does not read as an Indian mobile, offers **Open receipt** instead, which opens that bill's receipt page outside the app; a bill never offers both, and a cancelled bill offers neither; **Cancel this bill** sits at the right-hand end of the row; a demonstration bill sends on WhatsApp exactly as a real one does, and says only that its receipt link will not open; the WhatsApp colour passes AA in both themes; a biller opens **View receipt** on a bill in Bills this shift and that bill's receipt page shows in a pop-up inside the app, with nothing on it that leads out of the app, greyed out with a reason on a bill not yet synced, absent on a cancelled one, and saying so rather than showing a blank box when the tablet is offline; nothing is written; and the four-role demo walkthrough still walks.

## Why

Automatic receipt delivery (#59, `bill-receipt-delivery`) is waiting on a
regulator. On 2026-09-29 the owner said the channel is now **SMS through MSG91,
with Airtel DLT registration pending**, and that **the RCS plan is dropped for
now**. Until those approvals land, and whenever SMS later fails, a customer who
wants their bill has no way to get it except somebody finding the bill and
hand-sharing the link.

Today's **Share receipt** button makes that slower than it needs to be. It opens
the phone's share sheet. The owner picks WhatsApp, then has to find a contact the
customer almost never is, because nobody saves a customer's number to their
phone. The number is already on the bill. WhatsApp's click-to-chat link
(`https://wa.me/<number>?text=<message>`) opens a chat with any number, saved or
not, with the message already typed.

The owner also said the share button is **used almost only to get at the link**,
to look at the receipt or copy it. That is better served by opening the receipt
page itself than by a share sheet.

So each bill gets **one receipt action, chosen by whether the bill has a
number**.

## What changes

In Billing history, on an expanded bill that is not cancelled, the action row
changes from `[Share receipt] [Cancel this bill]` to:

```
Bill carries a phone number:
[ (WhatsApp) Send receipt ]                     [ ⊘ Cancel this bill ]

Bill carries no phone number:
[ ↗ Open receipt ]                              [ ⊘ Cancel this bill ]
```

- **Send receipt** is outlined like Cancel, with its label and WhatsApp's mark
  in WhatsApp's green where Cancel's are red [owner, 2026-09-30]. Tapping it
  opens WhatsApp on the phone (WhatsApp Web on a laptop) in a chat with the
  bill's own number, with a short message already typed that names the bill and
  its total and ends with the receipt link. **The owner still taps Send in
  WhatsApp.** No link can send a WhatsApp message by itself, and a person
  confirming the chat is the right one is part of the design, not a limitation.
- **Open receipt** opens the bill's receipt page, the one the customer sees, on
  `shawarmania.in`. On the installed app on Android this is a Chrome window over
  the app (a Custom Tab), whose menu shares the link, copies it, or opens it in
  full Chrome. On a laptop it is a new browser tab.
- **A bill offers one or the other, never both.** A bill that has a number but
  whose number does not read as an Indian mobile (a legacy free-text value) is
  treated as having none.
- **Cancel this bill moves to the right-hand end of the row**, away from the
  receipt action [owner, 2026-09-29]. Where a bill has no receipt link yet (not
  yet accepted by the server), Cancel stays on the right alone.
- **Demo mode works exactly as production** [owner, 2026-09-30]. Send receipt
  opens WhatsApp on the demo customer's number, because following it sends
  nothing: a person still taps Send in WhatsApp. The one difference is the note
  demo already carries, saying the receipt link will not open. *(First built
  with Send disabled in demo, since the demo's numbers look like real mobiles.
  The owner overruled that; see design D5.)*
- **The share sheet, the clipboard copy and the revealed-link fallback leave the
  bill.** They stay where they are for the public menu and for account handover.

## The counter shows the receipt, 2026-09-30

The owner is not always at the counter to send a receipt, and a customer who
asks for their bill usually just wants to see it. So the counter gets a third,
smaller way in, folded into this change because it answers the same request:

```
Bills this shift → Bill 27 (expanded)
  …items, tender, total…
  ─────────────────────────────────────────────
                                   [ View receipt ]

  [ View receipt ] ──► ┌──────────────────────────────┐
                       │ Bill 27 receipt      [Close] │
                       │ ┌──────────────────────────┐ │
                       │ │  the customer's receipt  │ │
                       │ │  page, exactly as their  │ │
                       │ │  link would show it      │ │
                       │ └──────────────────────────┘ │
                       └──────────────────────────────┘
```

- **View receipt** sits in a bill's expanded detail in the counter's **Bills this
  shift**. Tapping it opens a large pop-up **inside the app** showing that bill's
  receipt page, the real one on `shawarmania.in`. The biller turns the tablet to
  the customer, then taps Close.
- **Nothing in the pop-up leads out of the app.** The receipt's own links do
  nothing there, and the page is asked for its counter view, which leaves out
  Download PDF altogether (the site's `the-counter-views-the-receipt`). Nothing is
  copied, shared or sent.
- **While the receipt loads**, the pop-up shows a spinner with "Loading receipt…"
  rather than a blank box.
- **A bill not yet synced** has no receipt yet: View receipt is greyed out and says
  "Receipt appears once this bill syncs".
- **Offline**, the pop-up says the receipt needs the internet rather than showing a
  blank box.
- **A cancelled bill** gets no View receipt, as on the owner's side.
- **Demo** behaves as production: the pop-up shows the site's refusal page for the
  invented bill, with the demo note.

**This reverses one sentence of #54, and only one.** #54 kept a *share*
affordance off the counter tablet because "the tablet is shared hardware standing
in a shop". That reason is about handing a link out. This shows a bill on a screen
the biller and customer are already looking at, and the link never leaves the
tablet. The tablet still gets no Send receipt, no Open receipt and no Share.

## What this is not, and why that matters

This is **a person sending a message from their own WhatsApp**, one bill at a
time, to a customer who asked for it. It is not the automatic delivery #59
builds, and it inherits none of #59's machinery: no provider, no template, no
DLT, no suppression list, no inbound STOP, no consent record. None of that
applies to a message somebody types and sends themselves.

It does inherit one rule from #62: **a number given to earn points is not
consent to be messaged.** The owner or manager asks first ("want the bill on
WhatsApp?"). That is the owner's practice, stated in the docs, not something the
app can enforce.

## Decisions the owner made, 2026-09-29

- **A backup for SMS, not a replacement.** It stays after #59 ships, as the
  manual resend when an automatic send fails or a customer says it never arrived.
- **No QR code.** Offered as an alternative (the customer scans the receipt link
  off the screen). Refused: the point is a channel the owner is comfortable
  sending on.
- **Only the owner and franchise admins, as now.** Who stands at the counter does
  not change who sees this row. The counter tablet does not get it. *(On
  2026-09-30 the counter gained View receipt, which shows a receipt and sends
  nothing. See above.)*
- **Either/or, not two buttons.** Two receipt buttons plus Cancel were considered
  and refused. Three controls do not fit a phone-width row. The share sheet
  duplicated what the Custom Tab's own menu does. And the owner shares with the
  customer, which the number already names.
- **Cancel on the right, not centred at the foot.** The Outlets page settled
  destructive actions as a centred button at the foot. This row deliberately
  differs, because the receipt action and Cancel are peers on one line, and the
  gap between them is what keeps a thumb off Cancel.

## The one thing given up

When a bill has a number, **there is no way to open its receipt from the bill**.
That bites when the number is not on WhatsApp, when the customer's WhatsApp is on
a different number, or when the number was keyed wrong. In each case SMS is
already down (that is why WhatsApp is in use), so opening the link would only let
it be copied somewhere else. Accepted on 2026-09-29.

The cheapest escape, if it is ever wanted, is a **Send to someone else** that
opens WhatsApp with the same message and no number, letting WhatsApp pick the
chat (`https://wa.me/?text=...`). Recorded here so a later change can add it
without re-deriving it. **Not built now.**

## Non-goals

- **No sending, opening or sharing from the counter tablet.** It shows the
  receipt in the app and nothing else.

- **No automatic sending.** That is #59.
- **No WhatsApp Business API, no Meta account, no server-side send.** The link is
  free, keyless and client-only.
- **No points in the message.** The owner wanted points earned and the balance in
  #59's message. The bill Billing history reads does not carry them, and
  fetching them would widen that read into the points ledger. The receipt page
  the link opens already shows both (#62 D14). A follow-up can add them.
- **No customer name in the message.** Bills rung before #56 carry placeholder
  names typed to get past a UI rule (`As`, `Kk`), and a message opening "Hi As"
  is worse than one that names nobody.
- **No change to the counter, the tablet, offline, the outbox or any write.**
- **No change to receipt links**: how they are minted, revoked, or what the page
  shows.
- **No Send to someone else** (see above).
- **No change to #59 here.** Its proposal was corrected separately on
  2026-09-29 to name SMS through MSG91 as the channel.

## Docs to update before archiving

- [`docs/SCREENS.md`](../../../docs/SCREENS.md): Billing history's action row, the
  two receipt actions, Cancel on the right, and the demo behaviour; and the
  counter's View receipt in Bills this shift.
- [`docs/LIMITATIONS.md`](../../../docs/LIMITATIONS.md): "A receipt link is
  shared by hand" now reads as sent by hand on WhatsApp. Also record the Custom
  Tab ceiling on Android and the no-open-with-a-number trade.
- [`docs/SECURITY_AND_PRIVACY.md`](../../../docs/SECURITY_AND_PRIVACY.md): the
  number and the receipt link leave the app into WhatsApp on the owner's tap;
  nothing is logged; asking first is the practice; a points number is not
  consent.
- [`docs/DESIGN_SYSTEM.md`](../../../docs/DESIGN_SYSTEM.md): the WhatsApp tokens,
  why a third party's colour is in the token layer, and the Cancel-on-the-right
  exception to the destructive-at-the-foot convention.
- [`docs/OPERATIONS.md`](../../../docs/OPERATIONS.md): which WhatsApp account the
  message goes from (whichever is signed in on that phone), and the suggestion of
  a dedicated outlet number on the WhatsApp Business app.

## How to run the gate

- Expand a settled bill that carries a number. Tap Send receipt on a real Android
  phone with the app installed. WhatsApp opens on that number with the message
  typed. Send it to a number you own and confirm the link opens the receipt.
- The same on a laptop: WhatsApp Web, or its landing page, opens with the message.
- Expand a bill with no number. Tap Open receipt. The receipt page opens outside
  the app, and its menu offers Open in Chrome.
- A cancelled bill: no receipt action, no Cancel.
- A bill whose phone is a legacy unparseable string: Open receipt.
- Demo mode: Send receipt opens WhatsApp on the demo number with the message
  typed (do not send it), and the note says the link will not open.
- Phone and tablet widths, light and dark: the row holds on one line at 375px,
  and the contrast validator passes the new pair in both themes.
- At the counter (tablet width), expand a synced bill in Bills this shift and tap
  View receipt: the receipt shows in a pop-up, its PDF link does nothing, Close
  returns to the counter. A bill still in the outbox: greyed out with its reason.
  Offline: the pop-up says the receipt needs the internet.
- The four-role demo walkthrough still walks.

## User-only gate steps

- 🧍 The owner sends one real receipt to their own second number from the
  installed app, and judges the message wording and the button's look.
- 🧍 The owner confirms which WhatsApp account they want customers to see the
  message come from.
