## RENAMED Requirements

- FROM: `### Requirement: A bill's receipt link is shared from the bill itself`
- TO: `### Requirement: A bill's receipt is sent or opened from the bill itself`

## MODIFIED Requirements

### Requirement: A bill's receipt is sent or opened from the bill itself

> Restated by `a-receipt-goes-out-on-whatsapp`. #54 built one Share control. The
> owner used it almost only to reach the link, and wanted a customer's own bill
> sent to the number already on it, while automatic delivery (#59) waits on SMS
> registration.

An expanded bill in Billing history SHALL offer **exactly one receipt action**,
for the Super Admin and the Franchise Admin, positioned in the same action row as
the cancellation control and **before** it in reading order, with the
cancellation control at the row's far end.

The receipt action SHALL be **Send receipt** where the bill's customer phone
normalises to a canonical Indian mobile number, and **Open receipt** otherwise.
A bill SHALL NOT offer both. A phone value that does not normalise SHALL be
treated as no number, never corrected into a guess.

The receipt action SHALL be offered only for a bill that is not void and that has
a receipt link, and SHALL NOT be offered on the counter tablet, which shows a
receipt in the app instead and sends, opens and shares nothing.

The action SHALL read a link that already exists rather than creating one, and
SHALL grant no visibility a role did not already hold: a role SHALL be able to
act only on a bill it can already read, and never another outlet's.

#### Scenario: A bill with the customer's number

- **WHEN** the Super Admin expands a settled bill whose customer phone is
  `+919876543210`
- **THEN** Send receipt is offered before the cancellation control, Open receipt
  is not, and the cancellation control sits at the right-hand end of the row

#### Scenario: A bill with no number

- **WHEN** a settled bill carrying no customer phone is expanded
- **THEN** Open receipt is offered, Send receipt is not, and following it opens
  that bill's receipt page outside the app

#### Scenario: A legacy number that is not a mobile

- **WHEN** a bill rung before customer identification carries a phone value that
  does not normalise
- **THEN** Open receipt is offered and no WhatsApp link is built from the value

#### Scenario: A franchise admin and another outlet

- **WHEN** a Franchise Admin uses Billing history
- **THEN** they may act on bills at their own outlet only, because those are the
  only bills the surface shows them

#### Scenario: A cancelled bill

- **WHEN** a void bill is expanded
- **THEN** no receipt action and no cancellation control are offered, and any
  link already issued for it continues to resolve and reports the cancellation

#### Scenario: A bill the server has not accepted

- **WHEN** a bill without a receipt link is expanded
- **THEN** no receipt action is offered and the cancellation control still sits
  at the right-hand end of the row

## ADDED Requirements

### Requirement: Send receipt opens WhatsApp on the bill's own number with the message typed

Send receipt SHALL be a link to `https://wa.me/` followed by the bill's canonical
phone without its `+`, carrying a prefilled message as its `text` parameter. The
message SHALL name the bill number and its total, formatted from integer paise by
the one money formatter, and SHALL end with the receipt link on its own line. It
SHALL carry no offer, no points prompt and no customer name.

Following it SHALL NOT send anything by itself. The message SHALL be sent only by
the person, from within WhatsApp.

The link SHALL open outside the app in a new browsing context and SHALL NOT pass
the app's address as a referrer.

Send receipt SHALL be outlined like the cancellation control, with WhatsApp's
mark and its label in a WhatsApp green that passes AA in both themes, read from
semantic tokens.

#### Scenario: The link and the message

- **WHEN** bill 1489, totalling 26000 paise, with phone `+919876543210` and
  receipt link `https://shawarmania.in/bill/abc`, offers Send receipt
- **THEN** its link is `https://wa.me/919876543210?text=` followed by the encoded
  message, whose last line is `https://shawarmania.in/bill/abc` and which names
  `1489` and `₹260`

#### Scenario: Nothing is sent by following it

- **WHEN** the owner follows Send receipt
- **THEN** WhatsApp opens on that number's chat with the message in the compose
  field, and nothing is sent until the owner sends it

### Requirement: Open receipt opens the receipt page outside the app

Open receipt SHALL be a link to the bill's receipt URL, opening in a new browsing
context without a referrer. It SHALL NOT offer a share sheet, write to the
clipboard, or reveal the link as text. On an installed app the platform decides
the browsing context, and on Android that is a Chrome Custom Tab.

#### Scenario: Opening a receipt

- **WHEN** the owner follows Open receipt on a bill with no number
- **THEN** that bill's receipt page opens outside the app, and the app stays where
  it was

### Requirement: A demonstration bill behaves as a real one

> The owner decided on 2026-09-30 that demo mode works exactly as production
> here. Following Send receipt sends nothing, so opening WhatsApp on a demo
> customer's number is as safe as opening it on a real one.

Where a bill's receipt link is a demonstration link, the receipt action SHALL be
chosen and SHALL behave exactly as for any other bill: Send receipt SHALL link to
WhatsApp on the bill's number with the message typed, and Open receipt SHALL link
to the receipt URL. A note SHALL say that the receipt link will not open, because
the bill behind it is invented. Whether a bill is a demonstration SHALL be read
from its receipt link, never from the session.

#### Scenario: Demo mode

- **WHEN** a demo bill carrying a demo customer's phone is expanded
- **THEN** Send receipt links to `wa.me` with that number and the message whose
  last line is the demo receipt link, and the note says the link will not open

### Requirement: The counter shows a bill's receipt without leaving the app

> Added 2026-09-30. #54 kept a share affordance off the counter tablet because the
> tablet is shared hardware in a shop. This requirement hands nothing out: it
> shows a bill the tablet can already read, on its own screen.

An expanded bill in the counter's Bills this shift SHALL offer **View receipt**,
which SHALL open that bill's receipt page in a pop-up inside the app. The page
SHALL be shown in a frame that permits no script, form, pop-up, download or
navigation of the app, and SHALL be requested without a referrer. Closing the
pop-up SHALL return the counter exactly as it was.

View receipt SHALL read the link the bill already carries and SHALL NOT create
one. Where the bill has no link yet, because it has not reached the server, View
receipt SHALL be shown disabled with the reason. A void bill SHALL NOT offer it.
Where the browser reports the tablet offline, the pop-up SHALL say that the
receipt needs the internet instead of showing the frame. Until the page has
loaded, the pop-up SHALL show that it is loading, in the space the receipt will
fill. The page SHALL be requested in its counter view (`view=counter`), which
omits its download link.

#### Scenario: Waiting for the receipt

- **WHEN** View receipt is opened and the page has not loaded yet
- **THEN** the pop-up says the receipt is loading, and the receipt replaces that
  when it arrives

#### Scenario: Showing a customer their bill

- **WHEN** a biller expands a synced bill in Bills this shift and taps View
  receipt
- **THEN** a pop-up inside the app shows that bill's receipt page, and the
  counter is unchanged once it is closed

#### Scenario: A link on the receipt

- **WHEN** the receipt's Download PDF link is tapped inside the pop-up
- **THEN** nothing downloads and the tablet stays in the app

#### Scenario: A bill still in the outbox

- **WHEN** a bill rung offline has not reached the server
- **THEN** View receipt is disabled and says the receipt appears once the bill
  syncs

#### Scenario: Offline

- **WHEN** View receipt is opened while the tablet is offline
- **THEN** the pop-up says the receipt needs the internet and shows no frame

## REMOVED Requirements

### Requirement: Sharing degrades to the most capable thing the device offers

**Reason**: The bill no longer shares. A bill with a number sends to that number
on WhatsApp. A bill without one opens the receipt page, whose browser (a Custom
Tab on Android) offers share and copy itself. The share sheet, clipboard and
revealed-link cascade on the bill duplicated that menu.

**Migration**: None for data. The cascade survives in `useShareLink` for the
public menu and account handover, under their own requirements.
