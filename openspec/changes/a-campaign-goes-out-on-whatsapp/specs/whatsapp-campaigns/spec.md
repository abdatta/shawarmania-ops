## ADDED Requirements

### Requirement: Only an owner reaches campaigns, and the database is what refuses everyone else

Campaigns, their batches and recipients, the stopped list and the sender's
record SHALL be readable and writable only by a Super Admin, through functions
that re-derive that authority from the caller's own token. No client role SHALL
hold a policy or a grant on the tables themselves.

#### Scenario: A manager asks for the campaign list by hand

- **WHEN** a Franchise Admin sends a hand-crafted request for any campaign table
  or calls any campaign function
- **THEN** the database refuses it and returns no row

#### Scenario: A counter tablet, a biller and an employee ask

- **WHEN** a counter device session, a Biller or an Employee does the same
- **THEN** each is refused in the same way

### Requirement: An audience is chosen by filters that count, and never suggested

The system SHALL let an owner choose a campaign's audience at one outlet by how
recently a customer ordered, or whether they ordered between two dates and not
since, how many times, whether they are a gold member
there, how much they have spent, and when they were last sent a campaign, with
one sort order. It SHALL show the matching customers as a list, by name and
the last four digits of their number, with the filters and a search by name or
number above the list. An owner SHALL be able to pick customers one by one, or
all the filters match at once, and SHALL see how many are picked as they
change either. It SHALL NOT propose an audience, a filter or an order of its
own, SHALL pick nobody until the owner does, and an audience read SHALL NOT
return a full phone number.

#### Scenario: The partner narrows the audience

- **WHEN** an owner sets "ordered in the last 30 days" and "at least 5 orders"
  and selects all
- **THEN** the page lists the customers matching both, by name, and says how
  many are picked

#### Scenario: The partner picks two customers by name

- **WHEN** an owner searches for one customer's name and ticks them, then for
  another's number and ticks them
- **THEN** exactly those two are picked, whatever the filters show next, and
  the campaign goes to those two

#### Scenario: Recency is counted in business days

- **WHEN** a customer's only bill is on the business date 30 days before the
  outlet's current business date, rung after midnight
- **THEN** "ordered in the last 30 days" includes that customer

#### Scenario: Customers from a past stretch who have not come back

- **WHEN** an owner chooses "Between dates" from the 1st to the 30th of a past
  month, turns on "Not back since", and selects all
- **THEN** the audience is every customer with a settled bill at the outlet on a
  business date in that stretch, both days included, and none after it; a
  cancelled bill since does not count as coming back

#### Scenario: A stretch that ends before it starts

- **WHEN** an audience is sent whose first date is after its second, or a date
  that does not exist
- **THEN** the database refuses it, and never reads it as no filter

#### Scenario: The audience read is asked for numbers

- **WHEN** an owner's session calls the audience read
- **THEN** no row it returns carries more than the last four digits of a phone

### Requirement: A customer who said stop is in no audience

The system SHALL keep a list of customers who must not be sent campaigns. A
customer on it SHALL be excluded when an audience is counted, when a campaign is
scheduled and again when a recipient is about to be sent to, whatever the
filters say. An owner SHALL be able to add and remove a customer by hand. The
list SHALL NOT affect receipts or points. A campaign message SHALL be the body
as written, with no stop line added, and the sender SHALL NOT read incoming
messages, a reply of STOP included [owner, 2026-11-20].

#### Scenario: A customer asks not to be messaged

- **WHEN** an owner adds a customer's number to the stopped list
- **THEN** no later audience counts them

#### Scenario: A customer replies STOP

- **WHEN** a customer replies "stop" to a campaign
- **THEN** the sender does nothing with it, and the customer is stopped only if
  an owner adds them

#### Scenario: Stopped after scheduling, before their turn

- **WHEN** a customer is added to the stopped list while they are still waiting
  in a scheduled campaign
- **THEN** they are marked stopped when their turn comes and are sent nothing

#### Scenario: A stopped customer pays a bill

- **WHEN** a customer on the stopped list pays a bill with their number
- **THEN** they receive their receipt SMS and earn points as before

### Requirement: A campaign goes out in batches, and no batch starts until an owner releases it on the sender

Submitting a campaign SHALL fix its recipients, in the chosen order, into
batches of the size set at that moment (100 unless an owner has changed the
setting). A batch SHALL send nothing until an owner releases that batch from the
sender's own page on the machine that sends. The app SHALL offer no release
control and no time for a campaign to start at: when a batch goes is the
releasing owner's alone. At most one batch SHALL be sending at a time across
all campaigns.

#### Scenario: A campaign to a thousand customers is submitted

- **WHEN** an owner submits a campaign whose audience is 1,000 customers with
  the batch size at 100
- **THEN** ten batches exist, none released, and nothing is sent

#### Scenario: A batch is released

- **WHEN** the owner presses Send batch on the sender's page
- **THEN** that batch's customers are sent to, and the next batch still waits

#### Scenario: The setting changes after scheduling

- **WHEN** the batch size is changed while a campaign is part-sent
- **THEN** that campaign's remaining batches keep the size they were cut at

### Requirement: Sending is paced, and happens only in the customers' daytime

The sender SHALL send to one recipient at a time with an uneven wait between
them inside the limits set. The database SHALL refuse to hand over a recipient
outside the sending window, 10:00 to 21:00 Asia/Kolkata unless an owner has
changed it, whatever the sender's own clock says.

#### Scenario: A batch is released at night in India

- **WHEN** a batch is released at 23:00 Asia/Kolkata
- **THEN** no recipient is handed over until 10:00, and the app says the sender
  is waiting for the window

### Requirement: An interrupted send resumes at the next customer and never repeats one

The sender SHALL mark a recipient as being sent to before sending and as sent
after. When it starts or reconnects, any recipient still marked as being sent to
SHALL become **unsure**, and sending SHALL continue with the next waiting
recipient. An unsure recipient SHALL NOT be sent to again in that campaign by
any path.

#### Scenario: The lid closes mid-batch

- **WHEN** the laptop sleeps after 47 of a batch's 100 are sent, between two
  recipients, and wakes an hour later inside the window
- **THEN** sending continues with the 48th, and nobody among the first 47 is
  sent a second message

#### Scenario: The connection drops during one customer's message

- **WHEN** the sender is cut off after marking a recipient as being sent to and
  before recording the result
- **THEN** on return that recipient reads unsure, is not retried, and the next
  recipient is sent to

### Requirement: Either owner can pause or stop a campaign, and the sender asks before every message

An owner SHALL be able to pause, resume and stop a campaign from the app. The
sender SHALL be refused its next recipient while the campaign is paused or
stopped. A stopped campaign SHALL NOT be resumed.

#### Scenario: Pause during a batch

- **WHEN** an owner pauses a campaign while its batch is sending
- **THEN** at most the message already in hand goes out, and nothing more until
  it is resumed

### Requirement: The sender stops for good when WhatsApp ends its session

When WhatsApp logs the sender out, refuses it or restricts the account, the
sender SHALL stop, record why on its own machine and in the database, and send
nothing further until an owner restarts it by hand on that machine. A dropped
connection alone SHALL NOT count as this.

#### Scenario: The device is logged out mid-batch

- **WHEN** WhatsApp closes the session as logged out during a batch
- **THEN** the sender reads halted in the app with the reason, the batch's
  remaining customers stay waiting, and reopening the laptop does not resume
  sending

#### Scenario: Wi-Fi drops

- **WHEN** the network is lost for ten minutes
- **THEN** the sender reconnects and continues, and is not halted

### Requirement: The app says truthfully where the sender is and how far a campaign has got

The app SHALL show every owner the same reading: whether the sender is online
and when it was last seen, whether it is linked, halted, waiting for the window
or waiting for a batch to be released, and for each campaign how many recipients
are sent of how many, each batch's state, and for a finished batch how many were
delivered, read, not on WhatsApp, failed, unsure and stopped. It SHALL NOT show
a campaign as sending while the sender has not been seen.

#### Scenario: The laptop has been closed since yesterday

- **WHEN** an owner opens a scheduled campaign and the sender was last seen
  yesterday at 21:00
- **THEN** the page says the sender is offline since then and that the campaign
  will continue when it returns

#### Scenario: A campaign finishes

- **WHEN** the last batch of a campaign completes
- **THEN** the campaign reads done with its totals, and the owner who scheduled
  it is sent those totals on WhatsApp if their account carries a phone

### Requirement: The sender is linked by a QR code the phone's holder scans

The system SHALL link the sender to the business WhatsApp account by WhatsApp's
QR code, shown by the sender on a page served from the sender's own machine and
reachable from nowhere else unless an owner deliberately shares it. The page
SHALL always show the code that is currently valid, and SHALL stop showing any
code once the link succeeds or linking is abandoned. The system SHALL NOT offer
linking by a typed code.

#### Scenario: The phone is in another country

- **WHEN** the owner starts linking on the sender and shares its linking page
  with the partner through a temporary link
- **THEN** the partner sees the current code, scans it with the business phone,
  and the sender reads linked

#### Scenario: The code changes while nobody is ready

- **WHEN** WhatsApp replaces the QR code before it is scanned
- **THEN** the page shows the new code by itself, and the old one is shown
  nowhere

### Requirement: A recipient's number is read only at the moment it is sent to

A campaign's stored recipients SHALL carry no phone number and no name. A full
number SHALL leave the database only when one recipient is handed to the sender
for sending, to an owner's session, one at a time, and in the sender's history,
to an owner's session, for the sender's own page on the owner's laptop [owner,
2026-11-21]. The sender SHALL NOT keep numbers, message contents or the
account's other chats, and SHALL NOT log them.

#### Scenario: The owner looks at the sender's history

- **WHEN** the owner opens the sender's page on the laptop
- **THEN** it shows the tests and batches still to come, every message the
  laptop picked up, newest first, with the customer's name, whole number, how
  it ended and its receipts, and the sender's own diary; and a page from any
  other site open in the same browser cannot read it

#### Scenario: A number is corrected after scheduling

- **WHEN** a customer's record changes between a campaign being scheduled and
  their turn
- **THEN** the message goes to what the record says at their turn

### Requirement: The demo shows campaigns and sends nothing

In demo mode the Campaigns surface SHALL be walkable over mock data, including a
finished campaign, one part-sent and the sender shown online, offline and
halted, and SHALL send no message, link no device and write nothing to real
data.

#### Scenario: A demo campaign is submitted

- **WHEN** a person walking the demo submits a campaign
- **THEN** it appears with its batches waiting and no message leaves anything

### Requirement: Double asterisks are bold, in the preview and in the message sent

A message SHALL be sent with every pair of double asterisks that WhatsApp's own
rules would read as a pair, `**like this**`, written as single ones,
`*like this*`, so that text typed the way most apps write bold comes out bold
on the customer's phone with no asterisk showing. The app's preview SHALL be
drawn from the same text the sender sends, so it shows exactly that.

#### Scenario: A message written with double asterisks

- **WHEN** a campaign's body says `🍯 **Something sweet** ❤️`
- **THEN** the customer is sent `🍯 *Something sweet* ❤️`, which WhatsApp shows
  as bold with no asterisk
- **AND** the app's bubble shows "Something sweet" bold with no asterisk

#### Scenario: Asterisks that are not a pair are left alone

- **WHEN** a body holds `**` that does not open and close on one line, such as
  `5 ** 2` or a lone `**`
- **THEN** those characters are sent as written

### Requirement: A test can be sent from a submitted campaign

While a campaign is still going (submitted or paused), an owner SHALL be able
to add and remove its test numbers and press **Send test** on the campaign's
own page, as on a draft. The test SHALL be sent the message as the customers
will get it, by the laptop with no release and outside the sending window, and
SHALL send no customer anything. A stopped or finished campaign SHALL offer
neither.

#### Scenario: A test from a submitted campaign

- **WHEN** an owner adds their own number to a submitted campaign whose batches
  are all waiting and presses Send test
- **THEN** the laptop sends that number the message, and every batch is still
  waiting with nothing sent
