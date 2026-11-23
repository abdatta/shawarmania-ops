# Tasks: a-campaign-goes-out-on-whatsapp

No change gate (proposal, *Change gate*): a new surface held by the registry,
away from the counter, with a clean revert. The order below is the safety
property: the owner sees the pages before anything is real, the database is
proved to refuse everybody else before any number can leave it, and the sender
is rehearsed on staging with the owners' own phones before it touches a
customer.

## 0. Before building

- [x] 0.1 Put proposal questions A, B and C to the owner and record each answer
      in the proposal's decisions table. *(2026-11-16: everyone unless stopped,
      with the privacy wording updated; the partner is a Super Admin; cautious
      start accepted, link early.)*
- [x] 0.2 Read Baileys' current documentation (package name, pairing-code call,
      auth-state store, disconnect reasons, receipt events, on-WhatsApp check)
      and record the version chosen and anything that differs from `design.md`
      in a *Baileys as found* note at the end of `design.md`.

- [x] 0.3 **Link early** [owner, 2026-11-16: sending is wanted as soon as
      possible, and a device that has been linked for a while is the cautious
      start]. Build just enough of 4.1, 4.3 and 4.4 to connect and hold a link,
      before the pages: the sender prints its pairing code in its own terminal,
      the owner reads it to the partner on a call, and the partner enters it on
      the business phone. Leave it linked and connecting whenever the laptop is
      open while the rest is built. It sends nothing: no send path exists yet.
      This replaces the wait in 7.1.
      *(2026-11-17: built — `tools/campaign-sender`, commands `link`, `start`,
      `status`, `restart`, `unlink`; 26 unit tests.)*
      *(2026-11-18: **the business number is linked.** Not as written above:
      two pairing codes were refused by the business phone, so linking was
      rebuilt around a QR code, shown to the partner through a temporary link,
      and it linked on his first scan. The owner then had the pairing-code way
      removed. The link lives in its own folder beside the test link to the
      owner's personal number. Design, *The business number, linked by QR
      code*.)*

## 1. The pages, in the demo

- [x] 1.1 Add the surface to `src/gates/registry.ts` as `demo`, in the owner's
      navigation beside Customers. Not present for any other role.
      *(2026-11-18: `owner-campaigns`, under Analytics straight after
      Customers. There is no `admin-campaigns` entry, and `registry.test.ts`
      says so if one is added; `e2e/campaigns.spec.ts` opens a manager's, an
      employee's and the tablet's address and meets "That page does not
      exist".)*
- [x] 1.2 The adapter interface for campaigns, the sender line, audience counts
      and look-through, the stopped list; and the mock adapter with the scenario
      in design D15.
      *(2026-11-18: `src/data-access/campaigns.ts` and
      `mock/campaigns.ts`. **How the mock is typed with no migration yet:**
      #81 and #83 put their shapes into the migration first and hand-edited
      `database.types.ts` to match. This change keeps the migration for
      section 2, so design D5's five tables are written by hand at the top of
      `campaigns.ts`, in the generated file's own form, and the fixtures are
      typed from them. **Task 2.4 must replace each with `Tables<'…'>`**; a
      fixture the real schema cannot serve fails to compile then. The real
      adapter is a stub that refuses, for 3.1 to replace. Two things the mock
      had to decide, for section 2 to keep or change: an audience is the
      customers with a settled, uncancelled bill at the chosen outlet; and a
      campaign's stopped count is the recipients who replied STOP to it plus
      the ones already stopped at their turn, not the second alone. Design,
      *The pages, built in the demo*.)*
- [x] 1.3 The message renderer in `shared/` (`{name}`, the stop line, WhatsApp
      formatting to a preview), with unit tests: a missing name, formatting
      characters inside a name, an over-long body.
      *(2026-11-18: `shared/campaign-message.ts`, 21 tests in
      `src/lib/campaign-message.test.ts`. It imports nothing, so the sender can
      use the same file. The preview is runs of text with flags, never an HTML
      string. An over-long message is reported and never cut. The limit is
      1,024 characters, an image caption's commonly stated length: unverified,
      for 5.2 to check with a real image.)*
- [x] 1.4 Campaigns list, a campaign's page, the composer with its live bubble,
      the audience filters in a `FormSheet` with the live count and
      look-through, Schedule, Pause, Resume, Stop, the stopped list, the sender
      line in each of its states, including not linked, which says linking is done
      on the laptop and shows no code (design D9). Shimmers shaped like each
      page.
      *(2026-11-18: `src/features/campaigns/`. No page has a Send or a release
      control, and the tests fail if one appears. The demo banner carries a
      sender switch on these pages, six states, because the demo has no laptop.
      **Not built, and why:** *Sending a test* (proposal, *What changes*) has
      no function in design D5 or D6 and is not in this task's list; changing
      the batch size, window and gaps (the owner's settings) has no page; a
      draft cannot be deleted, because D5 has no state for it. Each is for the
      owner to ask for at 1.6.)*
- [x] 1.5 Look at all of it on a phone viewport, light and dark; run
      `npm run contrast`.
      *(2026-11-18: every page and every sender state walked in a real browser
      at 390 px, light and dark, from a preview on 7414, with no console
      error; 102 colour pairs pass. The bubble uses the surface tokens and the
      WhatsApp mark's existing token, and adds no colour.)*
- [x] 1.6 Show the owner the demo and record their approval, or their changes,
      in the proposal. **Do not start section 3 without it.**
      *(2026-11-18, first review, changes asked for and made: the bubble
      previews with the reader's own first name; choosing customers is a list
      with preset filters on top (decision 10); a campaign is submitted, with
      no time to choose (decision 11); the picture is shown whole.)*
      *(2026-11-18, second look, changes asked for and made: a tick on each
      customer with Select all, a search by name or number, gold or not beside
      the other filters, the outlet chosen for you, and enough demo customers
      for the list to scroll (decision 12).)*
      *(2026-11-18, third look, changes asked for and made: one scrollbar,
      on the list; a Filter button as the Billing page has, holding all but
      outlet and order; the outlet as chips, absent with one (decision 13).)*
      *(2026-11-18, fourth look: the list scrolls inside its own rounded box,
      and the order has an icon. One outlet per campaign kept (decision 14).)*
      *(2026-11-18: **approved** by the owner in the demo, as at f8382056.
      Recorded in the proposal, *The pages, approved in the demo*. Section 3
      may start once section 2 is done.)*

## 2. Database

- [x] 2.1 Failing pgTAP tests first: every table and every function refuses a
      Franchise Admin, a Biller, an Employee, a counter device and an anonymous
      caller, and answers an owner; `01_schema_coverage.sql` classifies the five
      tables; the audience read returns no full number; recency counts on
      `business_date`; spend is summed in paise over settled, uncancelled bills;
      a stopped customer is excluded at count, at schedule and at claim;
      scheduling cuts batches at the snapshotted size in the chosen order; a
      claim is refused when paused, stopped, unreleased or outside the window;
      claims are strictly one at a time; stale claims become `unsure` and are
      never claimed again; a second batch cannot be released while one is
      sending; a second sender installation is told to stand down.
      *(2026-11-18: written first and seen to fail on a database with no
      migration. `99_whatsapp_campaigns_are_the_owners.sql` (196 assertions)
      is who is refused: five tables and twenty-two functions, each asked for
      by a Franchise Admin, a Biller, an Employee, a counter tablet and an
      anonymous caller, with the list of functions a client may call held to
      the catalog so one added later without a refusal fails by name.
      `99_a_campaign_goes_out_on_whatsapp.sql` (207) is how a campaign
      behaves, every case above and the sender's seven answers as
      `core/rehearsal-queue.ts` gives them. `01_schema_coverage.sql`
      classifies the five tables and gains a section of its own for them.
      Also held, from the sender's later contract: the tick's waiting batch
      with its name and size, none while one is released, none before
      `not_before`, and "sent today" on India's day. And from proposal
      decision 12, which came after the first commit and was added the same
      day, tests first again: who is picked (`all` but the unticked, `only`
      the ticked whatever the filters say, nobody when it is not said), gold
      as three values, and the list's search.)*
- [x] 2.2 The migration: five tables, the functions, the `campaign-images`
      bucket and its owner-only policies. Run `npm run lint:migrations`.
      *(2026-11-18: `20261119000000_a_campaign_goes_out_on_whatsapp.sql`.
      `lint:migrations` passes with three statements admitted where they
      stand: the bucket's row in `storage.buckets` and its two policies on
      `storage.objects`, which the lint counts as changes to existing
      tables. The owner agreed to all three on
      2026-11-18. What the design left open and what was chosen is in design,
      *The database, built*: thirteen points, each with a test.)*
- [x] 2.3 `npm run db:reset`, `npm run test:db`, then the isolation cases in
      `test:rls` for every new table over HTTP.
      *(2026-11-18: in that order on one fresh stack. `test:db` 105 files,
      4,784 assertions. `test:rls` all eight phases green;
      `rest/whatsapp-campaigns.test.ts` is 31 cases over real sign-ins:
      every table and every function refused for the four roles and for an
      anonymous caller, a count refused too, the pictures refused over the
      storage API, and the owner's reads returning four digits and never a
      number. It writes nothing, so it can be run again on the same reset.
      The local Edge Functions container was dead, built from a worktree
      that no longer exists, and `test:rls` stops at its first phase
      without it: `npx supabase functions serve` from this worktree brought
      it back.)*
- [x] 2.4 `npm run db:types`; check the diff holds only this change.
      *(2026-11-18: 461 lines added and none removed, every one a campaign
      table, enum or function. **Left for the merge:** the five hand-written
      rows in `src/data-access/campaigns.ts` are on the pages' branch, not
      this one, so swapping them for `Tables<'…'>` waits until the two
      branches meet. Design, *The database, built*, lists where the real
      rows differ.)*

- [x] 2.5 **Test numbers** [owner, 2026-11-18]: up to five numbers an owner
      types onto a campaign, any number, not customers; sent by the sender by
      itself (no release, outside the window, ahead of any customer) on Send
      test and on Submit; numbers used before offered again. pgTAP first.
      *(2026-11-18: one new table, five functions, the tick and the claims
      taught about tests; 37 new pgTAP cases, the whole `test:db` green at
      4,856, the campaign REST probes 31 of 31, types regenerated. The sender
      sends them (`claimNextTest`), rehearsed once for real. The pages are
      built by the pages session. Design, *Test numbers*.)*

## 3. The pages, made real

- [x] 3.1 The live adapter over the functions in section 2. No screen imports
      the Supabase client.
- [x] 3.2 Image upload to the bucket, with a size limit and type check.
- [x] 3.3 Promote the surface to `live`; confirm demo mode still walks and
      still sends nothing.
- [x] 3.4 Authenticated browser tests: an owner writes, filters, schedules,
      pauses and stops a campaign; a manager has no Campaigns entry and a typed
      address does not resolve.
      *(2026-11-18, all four: the live adapter and the picture upload in
      `4cbeec0d`, the surface `live` and `e2e-auth/campaigns.spec.ts` in
      `5616003b`. The new auth spec passed alone on a fresh reset, 2 of 2; the
      demo's campaign spec 8 of 8, which fails on any request leaving the app,
      so the demo still sends nothing. The rest of the browser suites were not
      run. Design, *The pages on the real database*.)*

- [x] 3.5 **Ordered between two dates, not back since** [owner, 2026-11-20;
      proposal, decision 16]: pgTAP first, then
      `marketing_audience` replaced in place with the owner's lint exception,
      the demo, the sheet and the words.
      *(2026-11-20: 14 pgTAP cases, all 4,943 green after a reset; design,
      *Ordered between two dates*.)*

## 4. The sender

- [x] 4.1 `tools/campaign-sender/` with its own `package.json`; confirm nothing
      of it enters the PWA build (`npm run build`, bundle unchanged).
- [x] 4.2 The core behind `WhatsAppLink` and `CampaignQueue`, tests first, run
      by the root `npm test` with fakes: one at a time; the gap inside its
      limits; the window; pause obeyed before the next message; resume after a
      crash at each of the three points in a send, with no recipient sent twice;
      three failures in a row pause; logged out, forbidden and restricted each
      halt, locally first, and survive a restart; a dropped connection does not
      halt; nothing logs a number or a body.
      *(2026-11-17: the loop is `core/sending-loop.ts`, with 63 new unit
      tests; rehearsed on the owner's own two numbers with
      `npm run rehearse`, ten messages, killed twice mid-queue and nobody sent
      twice. Design D6 was rewritten to the loop's needs and gained three
      functions. What the rehearsal did and did not show is in design, *The
      sending loop, rehearsed*. STOP matching was in this task and is now 4.2a:
      it needs the incoming-message handler, which does not exist.)*
- [x] 4.2a ~~STOP in the core, tests first~~ *(removed 2026-11-20, 4.8)*: matched only as the whole message,
      from a recipient of a campaign in the last 30 days, with the sender
      resolved to a phone number and never a LID (design, *Baileys as found*).
      *(2026-11-19: `core/stop-reply.ts` and the loop, unit-tested; the
      thirty days are the database's (`campaign_record_stop`). Not yet seen on a
      device: the staging rehearsal's reply of STOP (5.2) is the first.)*
- [x] 4.3 The Baileys adapter: connect, link by QR code, on-WhatsApp check, send
      text and image with caption, receipts, incoming STOP, no history sync, no
      message store.
      *(2026-11-17: all but incoming STOP is built. The on-WhatsApp check, text,
      an image with a caption and a number not on WhatsApp were run for real in
      the rehearsal. A message refused after sending, and WhatsApp's two ways
      of saying an account is restricted, are wired from Baileys' source and
      cannot be run without a restricted account. 2026-11-18: with the second
      phone back online, nine `read` receipts arrived for the nine messages
      recorded as sent, in a later run than any of them, and each was matched
      and recorded. 2026-11-19: incoming STOP is built: only a whole-message
      STOP is read past the one question, and its sender resolved to a number
      by the message itself or Baileys' LID mapping.)*
- [x] 4.4 Owner sign-in in the terminal and the session file; the data folder
      and what the runbook must say about it (design D4).
      *(2026-11-18: `npm run sign-in`, `sign-out`; `npm start` runs the
      sender on the real queue when signed in, and only holds the link when
      not. Run end to end on the local database to the owner's own number:
      a test number sent with no press, Send batch on the laptop's page, the
      customer sent, the campaign done. It found the tick broken over HTTP;
      fixed. Design, *The sender on the real database*. The runbook's part is
      task 6.1.)*
- [x] 4.5 The local page (state, India time and the window, sent today, Send
      batch, Restart sender), bound to `127.0.0.1` only; its port in
      `ports.ts`. **Not the linking page's port**: that page is sometimes put
      on a public link, and this one must never be (design D9).
      *(2026-11-18: built and used by the owner. Restart sender is
      `npm run restart` in the terminal, not a button: a halt ends the
      sender, so no page is up to press it on.)*
- [x] 4.6 Windows: the install command that creates the logon task, and the
      notifications for a releasable batch, a finished campaign and a halt.
      *(2026-11-19: a script in the owner's own Startup folder, not a logon
      task (no administrator needed), by `npm run install-startup`; the
      notifications are the pinned card and the tray icon [owner,
      2026-11-18]. The script's quoting was proved with a stand-in for node;
      a real logon has not been tried: the owner runs the install.)*
      *(2026-11-21: the script now runs the keeper (4.9), and
      `install-startup` starts it at once too; installed on the owner's laptop
      for the business folder, on the owner's word.)*
- [x] 4.7 The finished-campaign WhatsApp to the owner who scheduled it.
      *(2026-11-19: `campaign_finish_notices` and `campaign_mark_finish_notice`,
      pgTAP and REST; the sender sends once nothing else is going. Not yet seen
      on a device.)*

- [x] 4.8 **No stop line, no STOP replies** [owner, 2026-11-20; proposal,
      decision 15]: the message is the body alone; the sender reads no incoming
      message; the stopped list stays for owners' hand entries.
      *(2026-11-20: renderer, bubble, sender and demo; design, *No stop line*.)*
- [x] 4.9 **The sender keeps running until somebody stops it** [owner,
      2026-11-21]: a keeper restarts it whenever it exits, except after the
      owner's stop (`npm run stop`, the tray's *Stop the sender…*) or a halt.
      *(2026-11-21: `core/keep-running.ts`, tests first; killed, stopped and
      restarted for real on staging; design, *The sender keeps running*.)*
- [x] 4.10 **The sender's history** [owner, 2026-11-21; proposal, decision
      17]: Coming up and Sent from the database with whole numbers, and the
      sender's own diary on the laptop, on the sender's page.
      *(2026-11-21: `campaign_sender_history` tests first, `core/diary.ts`
      and `core/history.ts` tests first; design, *The sender's history*.)*
- [x] 4.11 **The tray icon's colours** [owner, 2026-11-22 and 23]: a handful
      of colours for the kind of moment (blue all well, green the owner's go,
      yellow mending, red halted, grey quiet, black not running), pulsing while
      it works, blinking only while it waits on the owner, the same on the page.
      A dropped connection told apart from starting up, and ten minutes of
      failing to mend counted as stuck.
      *(2026-11-23: the agreement, reconnecting and stuck tests failing first;
      chosen on the real tray; design, *The tray icon's colours*.)*

- [x] 4.12 **Double asterisks are bold** [owner, 2026-11-24]: a pair of `**`
      is sent as `*`, by the one renderer the bubble and the sender share, so a
      campaign already submitted with `**` goes out bold once the laptop has
      the build. *(Design, *Double asterisks, and a test after Submit*.)*
- [x] 4.13 **Send test from a submitted campaign** [owner, 2026-11-24]: the
      test numbers and Send test on the campaign's page while it is going.
- [ ] 4.14 After the Promote: update the sender's checkout on the laptop, send
      a test of the submitted campaign to the owner's own number, and see the
      headline bold with no asterisk before its first Send batch.

## 5. Staging rehearsal

- [x] 5.1 Push to `stage`; read the Staging run green.
      *(2026-11-19: run 44562987411 on `45ed67ae`, all 25 jobs green, staging
      migrated and published. Two runs before it failed only the owner's new
      campaign browser spec, in the fourth auth shard: the seed customer it
      looked for had been pushed off the list's first page, then renamed, by
      specs that run earlier there; it now searches by number. The smoke job
      failed once at a staging sign-in and passed on a rerun.)*
- [ ] 5.2 On the staging project, with a WhatsApp account that is **not** the
      business number as the sender and the owners' own numbers as the only
      customers: link by QR code shown through a temporary link; send a test; schedule
      a campaign of a handful; release a batch; close the lid mid-batch and
      reopen; pause and resume from a phone; add one number to the stopped
      list and schedule again; try *Between dates* with *Not back since*; remove the linked device from the phone mid-batch and
      confirm the halt holds across a restart. **With the receiving phone
      online**: see delivered and read counted on the campaign's page while the
      batch is still sending (the rehearsal of 4.2 saw receipts only in a later
      run, and all as `read` with no `delivered` before it).
- [ ] 5.3 Record what happened in `verification.md`, including anything
      Baileys did that the fakes did not model, and fix the fakes.

## 6. Docs and the site

- [ ] 6.1 Every page listed in the proposal, the runbook above all: install,
      link with the partner, a first campaign, moving the sender, revert (Stop
      or quit the sender, then revert), and a restricted or banned number, with
      the ban steps checked against WhatsApp's own help pages on the day.
      *(2026-11-19: the runbook is in `docs/OPERATIONS.md`, *WhatsApp
      campaigns: the sender on the laptop*. Still owed: the other pages the
      proposal lists, and the ban steps checked against WhatsApp's help pages.)*
- [ ] 6.2 The privacy page and terms on `shawarmania.in`, in the landing
      repository, as decision A requires, published before 7.1.
- [ ] 6.3 `openspec/todos/customer-loyalty-and-cross-outlet-insights.md`: note
      that *stop messaging* is now separate from the points programme.

## 7. The first real campaign

- [ ] 7.1 After the owner's Promote: install the sender on the owner's laptop,
      link the business number with the partner, and leave it linked and idle
      for some days.
- [ ] 7.2 Chat backup confirmed on, on the business phone.
- [ ] 7.3 A first campaign to a few dozen regulars, written by the partner,
      released by the owner. Read its receipts and stops with the owner before
      a second batch.

## 8. Phase gate

- [ ] 8.1 **PHASE GATE (#85):** the owner approved the Campaigns pages from the
      demo before any of it was wired live; a campaign written on a phone, with
      an image and a chosen audience, reached its first batch of customers on
      WhatsApp from the business number, sent by the owner's own laptop; no
      batch started until the owner released it on that laptop; the lid closed
      mid-batch and opened later resumed at the next customer and sent nobody a
      second message; a number on the stopped list is in no later audience
      (replying STOP was dropped on 2026-11-20, decision 15); both owners
      watched the same progress; the sender stopped and stayed stopped when its
      WhatsApp session was ended; a manager, a biller, an employee and
      a counter tablet were each refused every campaign table and read by the
      database, proved by hand-crafted requests; and the four-role demo
      walkthrough still walks.
