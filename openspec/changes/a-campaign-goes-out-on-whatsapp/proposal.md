# Proposal: A Campaign Goes Out on WhatsApp

> **Model**: Opus · **Wave**: F · **Roadmap**: #85 (renumbered from #84 on 2026-11-19, which `a-dish-can-show-its-photo` had taken first; owner request, 2026-11-16;
> designed in conversation with the owner the same day) · **Depends on**: #32
> (one customer per phone), #10 (bills, which every audience filter reads), #62
> (gold at an outlet), #57 (the Customers surface this sits beside) ·
> **Related**: #59 `bill-receipt-delivery` (the app's other outgoing message, and
> the consent wording this change must extend), #46
> `aggregator-login-live-stages` (the same shape: the app asks, a program on
> somebody's machine does, the app shows where it has got to) · **Gate**: the
> owner approved the Campaigns pages from the demo before any of it was wired
> live; a campaign written on a phone, with an image and a chosen audience,
> reaches its first batch of customers on WhatsApp from the business number,
> sent by the owner's own laptop; no batch starts until the owner releases it on
> that laptop; the lid closed mid-batch and opened an hour later resumes at the
> next customer and sends nobody a second message; a customer who replied STOP
> is in no later audience; both owners watch the same progress; the sender
> stops and stays stopped the moment WhatsApp ends its session; a manager, a
> biller, an employee and a counter tablet are each refused every campaign
> table and read by the database, proved by hand-crafted requests; and the
> four-role demo walkthrough still walks.

## Why

The business has about a thousand customers' phone numbers, given at the
counter, and a WhatsApp Business account on one phone. Telling those customers
about an offer today means typing to them one at a time. The owner's partner,
who runs that phone in India and works from it, wants to write a message once,
choose who gets it, and have it go out.

Three constraints shaped everything below, and each is the owner's:

- **No paid service and no official WhatsApp API.** Sending goes through
  WhatsApp's linked-device connection, the one WhatsApp Web uses, by the Baileys
  library.
- **Supabase's free plan only.** Its functions cannot hold a connection open for
  the hours a campaign takes, so something outside Supabase must send.
- **Two or three campaigns a month**, not a daily tool.

## What changes

**A Campaigns page for the owners, built for a phone.** It sits beside
Customers. It is a list of campaigns, and each opens as its own page.

- **Writing one.** A message with WhatsApp's own formatting, shown as the bubble
  the customer will see as it is typed. `{name}` becomes the customer's saved
  name, and a customer with no saved name gets the greeting without one. One
  image, optional.
- **Choosing customers.** A list of the customers with a tick on each, and
  above it a search by name or number, the outlet as chips (where there is
  more than one), the order, and one **Filter** button as the Billing page has
  (decisions 10, 12 and 13). Behind Filter: ordered at the chosen outlet
  within, or not within, a number of days; spent at least an amount; gold or
  not; ordered at least or at most a number of times; and never sent a
  campaign or not sent one within a number of days. Each is a choice from a
  short list of presets. **Select all** picks everybody the filters match; a
  tick takes one out or puts one in. One sort order (most orders first, most
  recent first, longest away first), which decides who is in the first batch.
  **The app suggests no audience** [owner]: it opens with nobody ticked, and
  gives the tools and the counts and nothing else.
- **Sending a test.** The message goes to one number the owner types, so they
  see it in a real chat before anybody else does.
- **Submitting.** There is no Send button and no time to choose (decision 11).
  The partner submits the campaign, and the page says in a line what happens
  next: it is sent later from the laptop, a batch at a time.

**The audience goes out in batches of 100, and each batch waits for the owner.**
The partner may choose a thousand people; the campaign cuts them into batches in
the chosen order. One batch is about an hour and forty minutes of sending. The
size is a setting only the owner changes.

**The owner's own laptop sends.** A small program, the **sender**, starts with
Windows and stays in the background. It is linked to the business WhatsApp as a
linked device.

- **Releasing a batch happens on the laptop** [owner]. When a campaign is
  waiting, Windows shows a notification; it opens the sender's own page on the
  laptop, which shows the campaign, the batch and one button to send it. Nothing
  goes out until that button is pressed, and it is pressed once per batch.
- **One customer at a time, about a minute apart**, at uneven gaps, and only
  between 10:00 and 21:00 India time, so nobody is messaged at night.
- **Closing the lid is normal.** The sender stops; when the laptop wakes it
  reconnects and carries on with the next customer. If it was cut off in the
  middle of one customer's message it cannot know whether that message left, so
  it marks that one customer **unsure** and never sends to them again in that
  campaign. One customer may miss an offer; nobody gets it twice.
- **Pause and Stop are in the app**, for either owner, on any phone. The sender
  asks before every message.
- **It stops for good at the first sign of trouble.** If WhatsApp ends the
  session, logs the device out or restricts the account, the sender stops, says
  so on the laptop and in the app, and sends nothing more until the owner
  restarts it by hand.

**Both owners see the same progress.** A campaign's page shows how many of how
many are sent, a row per batch (waiting, sending 47 of 100, done), and for each
finished batch how many were delivered, read, not on WhatsApp, unsure, and how
many replied STOP. Above it, one line says whether the sender is online, when it
was last seen, and whether a batch is waiting for release. When a campaign
finishes, the sender sends the person who scheduled it a WhatsApp message with
the totals.

**A customer can stop the messages.** Every campaign message ends with a line
saying how. A reply of STOP, from that customer's number, puts them on a stopped
list; they are in no later audience and no filter can bring them back. The
Campaigns page shows the list and lets an owner add or remove a number by hand,
for a customer who asks at the counter. It does not affect receipts or points.

**Linking happens across two countries, by QR code.** The business phone is in
India with the partner; the laptop is in Los Angeles with the owner. The sender
shows WhatsApp's QR code on a page of its own on the laptop, which keeps up as
the code changes every few seconds. The owner opens that page to the partner
through a temporary link, and the partner scans it with the business phone
under *Linked devices → Link a device*. (The first plan was a code the partner
types. It was refused every time on the business number; see decision 9.)

## Owner decisions, 2026-11-16

| # | Question | Decision |
|---|---|---|
| 1 | Official WhatsApp API or a paid sender? | **Neither.** The linked-device connection, by Baileys, at no cost. |
| 2 | Where does sending run? | **On the owner's own everyday laptop**, not a spare one, not a phone, not a cloud machine. It is open most days and the owner wants to see each batch go. |
| 3 | Which number sends? | **The main business number.** A second SIM for marketing was offered and refused. The owner accepts that a ban would take the number customers message, and asked for the recovery steps, which go in the runbook. |
| 4 | Cap the audience at 100, or batch a large one? | **Batch a large one.** Any audience, 100 at a time. |
| 5 | Who releases a batch? | **The owner, on the laptop that sends**, not on a phone. |
| 6 | Should the app suggest who to send to first? | **No.** Filters, counts and a sort order; no suggestions. |
| 7 | A thousand in a day? | The owner thinks a thousand a day at one a minute is not spam. **Kept as a judgement the owner makes per batch**: there is no daily limit, and releasing a batch shows how many went out today and when the last batch finished. The runbook recommends a small first campaign. |
| 8 | The partner running a sender too? | **Later.** One sender, the owner's, now. |
| 9 | How is the laptop linked to the business WhatsApp? (2026-11-18) | **By QR code only.** A typed pairing code linked the owner's own number, then was refused each time on the business number with the partner waiting; a QR code shown to him through a temporary link worked on the first scan. The pairing-code way is removed. The QR page is served from the laptop itself (`127.0.0.1`), and is put on a temporary public link only when the phone is somewhere else. Showing the QR inside the app's Campaigns page is not built and not decided. |
| 10 | What does choosing who look like? (2026-11-18, on seeing the demo) | **A list of customers with the filters on top of it.** The first build opened on a form of filters, with the customers behind a button, and did not read as the customer list being narrowed. Now the customers show as the sheet opens and load more on scrolling, as the Customers page does. **Filters are presets, two to a row**: nothing to type a number into. Outlet, sort, last ordered and spent are always shown; order count, gold and sent-a-campaign sit behind *More filters*. |
| 11 | Does the partner choose when it goes? (2026-11-18, on seeing the demo) | **No. A campaign is submitted, not scheduled.** "As soon as possible" and "not before a time" were promises the app cannot keep: when a message goes depends on the laptop being open, on the owner sending each batch, and on an hour or more of sending per batch. The button is **Submit**, with one line under it saying it is sent later from the laptop. The pages never say "scheduled". The rows may keep that word; the app sets no start time. |
| 12 | How are customers picked from the list? (2026-11-18, second look at the demo) | **A tick on each customer, a Select all, and a search.** The owner asked for one search bar for name and number, a gold-or-not filter beside the others, Select all, the outlet chosen for him where there is only one, and the list filling the screen when there are enough customers. A new campaign opens with **nobody ticked**. *Select all* picks everybody the filters match, and keeps doing so as the filters change; unticking one of them leaves that one out. Customers ticked one by one stay picked whatever the filters show next; search only finds them. Changing the outlet starts the picking again. The outlet opens on the one last used, as every outlet page does, and is not offered at all where there is one. |
| 13 | How is the picker laid out? (2026-11-18, third look at the demo) | **Only the customer list scrolls.** Above it, and still: the search beside a **Filter** button drawn and behaving as the Billing page's (an icon; every filter but outlet and order is behind it, as chips applied as tapped; what is in force is said under the search with **Clear**), then the outlet as the chips every outlet page uses (absent where there is one), then Select all with the order beside it. The first build's two scrollbars were a fault, not a choice: screen-reader words in rows below the fold were placed against the whole sheet, which made the sheet scroll as well as the list. |
| 14 | Can one campaign go to several outlets' customers? (2026-11-18) | **No, one outlet per campaign.** The filters (orders, spend, gold, when last seen) are each a relationship with one shop, as on the Customers page, and the database holds one outlet. Kalyani Cafe is the only trading outlet for the months ahead, so there is nothing to combine yet. Revisit when a second outlet trades: orders and spend would be summed over the chosen outlets, gold and the last order read at any of them. |

### Three more, answered by the owner the same day

These surfaced while writing the proposal and were put to the owner, who
answered all three: **A — everyone with a number unless they said stop, and the
privacy wording is updated to say so. B — the partner is a Super Admin, so
owner-only is enough. C — a cautious start is accepted, and the sender is to be
linked as early as possible, because the owner wants to be sending soon.** What
each question was is kept below, because the reasons outlive the answers.

- **A. Who may be sent a campaign.** `docs/SECURITY_AND_PRIVACY.md` says today,
  in these words: *"Giving a number is not consent to be messaged. A customer
  gives it to earn points, and that is all it agrees to."* The landing site's
  terms and privacy page, published for #59, promise a receipt SMS and nothing
  more. This change reverses that. The proposal assumes the owner's intent:
  **every customer with a number may be sent a campaign unless they have said
  stop**, with the privacy page and terms on `shawarmania.in` changed to say so
  **before** the first campaign, and the stop line on every message. The
  narrower choice is to send only to customers who agree from now on, which
  needs a question at the counter and starts from an empty list. The owner
  should say which, knowing India's data-protection law treats marketing as a
  purpose a person agrees to.
- **B. The partner's sign-in.** Campaigns are for owners only (Super Admin).
  This assumes the partner signs in as one. If they sign in as a manager, either
  they become an owner in the database or this needs a narrower permission,
  which is more work and a wider door onto the customer list.
- **C. A laptop in Los Angeles on an Indian business number.** WhatsApp does not
  publish what it flags, so this is not known to be safe or unsafe. A linked
  device abroad is ordinary; a newly linked device abroad that starts sending to
  hundreds of strangers is less so. The proposal's answer is caution, not a
  guarantee: link the sender some days before the first campaign, make the first
  batch a few dozen regulars, and keep the sender able to move to the partner's
  laptop in India unchanged (decision 8) if the first batches go badly.

## The pages, approved in the demo

**Approved by the owner on 2026-11-18**, in the demo, after four rounds of
changes the same day, each recorded above as decisions 10 to 14 and in the
design's *The pages, built in the demo*: the bubble greets with the reader's
own first name; choosing customers is the customer list, nobody ticked, with
a search, a Filter button as the Billing page has, the outlet as chips and the
order, ticked one by one or with Select all, scrolling inside its own box; a
campaign is submitted, never scheduled for a time; the picture is shown whole;
and a campaign goes to one outlet's customers. This is the approval the
phase gate's first clause asks for. What the owner has not seen is anything
live: the database (section 2) and the live adapter (section 3).

## Change gate

**No gate:** Campaigns is a new surface that `src/gates/registry.ts` holds back
(`hidden`, then `demo` for the owner's approval, then `live`), and it is away
from the counter and kitchen with a clean revert.

- **The revert is clean.** Everything the change adds is new and read only by
  the new build: new tables, new functions, a new storage bucket, a new page.
  It alters no existing table, function, policy or row, queues nothing in any
  outbox, and stores nothing in a tablet's browser. A build from before it runs
  exactly as it does today.
- **It cannot reach the counter or kitchen.** No tablet loads the page or calls
  its reads. Its only contact with tables the counter uses is the audience
  count, a read of `bills` and `customers` that an owner triggers by changing a
  filter, over about a thousand customers. The sender is a separate program on
  a laptop and asks the database one small question a minute while a campaign
  is open.
- **The switch that matters is not a deploy.** Sending is stopped in seconds by
  Pause or Stop in the app, which the sender obeys before its next message, and
  by quitting the sender on the laptop. A message already sent cannot be taken
  back by any gate.

## Non-goals

- **The official WhatsApp Business API, SMS campaigns, or any paid provider.**
- **A sender anywhere but the owner's laptop** [owner]: not Supabase, not a
  cloud machine, not a phone, not the partner's laptop yet. The sender is built
  so that last one is a later installation, not a rewrite.
- **Automatic sending.** No batch goes without the owner's press, no campaign
  repeats itself, nothing is triggered by a birthday, a visit or a lapse.
- **Suggested audiences, scoring or segments the app invents** [owner].
- **Managers, billers, employees and tablets.** None sees a campaign or the
  stopped list. A franchise's own campaigns to its own customers wait for a
  franchise to ask.
- **Reading or keeping the business's chats.** The sender is a linked device,
  so WhatsApp delivers the account's messages to it. It acts on one thing, a
  reply of STOP from a campaign recipient, and keeps nothing else.
- **Replies in the app.** A customer who answers a campaign is answered from the
  business phone, as today.
- **Videos, documents, several images, buttons or polls.** One text and one
  image.
- **Changing receipts.** The receipt SMS (#59) and Send receipt (#63) are
  untouched, and the stopped list does not apply to them.
- **Getting a banned number back.** The runbook says what to do; nothing in the
  app can do it.

## Docs this change updates before it can archive

- `docs/SECURITY_AND_PRIVACY.md` — the rule that giving a number is not consent
  to be messaged is rewritten with its reason, not deleted; what the sender
  holds on the laptop; that it is a linked device and what it discards; the
  stopped list.
- `docs/DATA_MODEL.md` — the campaign, batch, recipient, stopped-list and sender
  tables, and why a recipient row holds no phone.
- `docs/SCREENS.md` — Campaigns, a campaign's page, the sender line.
- `docs/ROLES_AND_PERMISSIONS.md` — owners only, and the first read that lists
  customers by anything but a typed name or number.
- `docs/ARCHITECTURE.md` — the sender: a program on a person's machine that the
  app asks and never commands.
- `docs/OPERATIONS.md` — a runbook: installing the sender, linking it with the
  partner, a first campaign, moving the sender to another laptop, and what to do
  when WhatsApp restricts or bans the number.
- `docs/LIMITATIONS.md` — unofficial sending can end without warning; *unsure*;
  a campaign waits for a laptop; receipts on a customer's phone are not proof
  they read it.
- `docs/GLOSSARY.md` — *campaign*, *batch*, *sender*, *stopped*.
- `docs/BUSINESS_CONTEXT.md` — who runs the business WhatsApp and from where.
- **Outside this repository:** the privacy page and terms on `shawarmania.in`
  (the landing repository), before the first campaign (decision A).
