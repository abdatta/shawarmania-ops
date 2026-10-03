# Tasks: the-receipt-says-its-yours

> Read [`proposal.md`](proposal.md) and [`design.md`](design.md) first. No new
> table, so no isolation test is owed; the one function replaced here is
> `service_role` only, and `51_the_public_receipt_reader.sql` still asserts that
> `anon` gains no grant.

## 1. The spec, argued first

- [x] 1.1 `specs/public-bill-receipt/spec.md`: modify *The public receipt names no
      customer* (the name never; the last four digits and gold only with a customer;
      #54's reasoning, the spent second factor, the name refused a second time), and
      add *The receipt says how the bill was served*.

## 2. The projection

- [x] 2.1 Failing first, in `supabase/tests/51_the_public_receipt_reader.sql`:
      `phone_last4` is `0042` for the readable bill; the full number, the name and
      the customer id still appear nowhere at any depth; no top-level key is one the
      landing tripwire refuses; a bill with a phone and a name and **no**
      `customer_id` returns null digits and no gold; a skipped bill returns null
      digits and no gold.
- [x] 2.2 Failing first, same file: a bill rung while its customer was gold at the
      bill's outlet returns `gold_at_outlet = true`; after that spell is revoked the
      same receipt still does; a customer gold at another outlet reads `false` here.
- [x] 2.3 Failing first, same file: `service_type` comes back as the bill stored
      it, and null for a bill that recorded neither; the table never appears.
- [x] 2.4 Migration `20260930000000_the_receipt_says_its_yours.sql`: `create or
      replace` `bill_public_receipt` from its latest definition (#62's), adding the
      four keys of design D1 and nothing else; same signature, so its grants stand.
- [x] 2.5 `npm run db:reset`, `npm run test:db`, `npm run test:rls`,
      `npm run db:types` with a clean diff of `src/data-access/database.types.ts`.

## 3. The landing Worker (sibling change, `C:\Users\iamro\Code\shawarmania`)

- [x] 3.1 Seed `openspec/changes/the-receipt-says-its-yours-page/` there: proposal
      naming this change as its parent, the spec delta for `public-receipt-page`, and
      tasks.
- [x] 3.2 Failing first: the content model's holder and service lines over new bill
      shapes, in the page / PDF agreement test; the counter view shows them; the
      tripwire refuses a ten-digit run and a malformed `phone_last4`, and passes a
      new-shape payload; the **live** key list passes a new-shape payload.
- [x] 3.3 `receipt.ts` types and tripwire, `content.ts`, `page.ts`, `pdf.ts`.
- [x] 3.4 `privacy/`: the receipt paragraph's new words, for the owner to approve.
      `/messages/` untouched.
- [x] 3.5 `npm run worker:typecheck`, `npm run worker:test`, `npm run build`; the
      page and the PDF looked at on a phone width, in the customer and counter views.

## 4. Docs

- [x] 4.1 `docs/SECURITY_AND_PRIVACY.md`: the receipt section (name never, four
      digits and gold now, the spent second factor), the points row, the misdelivery
      note.
- [x] 4.2 `docs/SCREENS.md`: the public receipt's contents and the counter view.
- [x] 4.3 `docs/LIMITATIONS.md`: *A receipt link cannot be recalled*, and the
      service-line entry, resolved.
- [x] 4.4 `docs/OPERATIONS.md`: *"which is why the page names no customer"*.
- [x] 4.5 `docs/DATA_MODEL.md`: what the reader returns of the customer.
- [x] 4.6 #63's `design.md` misdelivery note.

## 5. Verify

- [x] 5.1 `npm run format`, then `lint`, `format:check`, `typecheck`,
      `functions:typecheck`, `test`, `contrast`, `build`, `test:e2e`.
- [x] 5.2 The Docker job: `test:db`, `test:rls`, `test:e2e:auth`, generated types.
- [x] 5.3 A seeded receipt read end to end: the local database's
      `bill_public_receipt` payload rendered by the new Worker code, for each shape
      in the gate, customer view, counter view and PDF.

## 6. Release and PHASE GATE

- [x] 6.1 Commit locally. **Do not push or deploy**: the owner picks the windows
      (`no-pushes-while-the-counter-trades`).
- [ ] 6.2 🧍 The owner approves the privacy page's words.
- [x] 6.3 🧍 Release: the ops push (migration) at any time; the landing push and
      `npm run worker:deploy` together, the privacy page no later than the Worker.
      *(Checked 2026-10-03. Migration `20260930000000_the_receipt_says_its_yours` is
      applied in production. The landing `main` has nothing unpushed, and the live
      receipt of a bill with a customer shows the last four digits and neither the
      name nor the full number, in the customer page and in the counter view; that
      is this change's Worker, so it is deployed. `/privacy/` answers 200.)*
- [ ] 6.4 **PHASE GATE — the ROADMAP.md checkpoint for #58**, walked: a customer
      opening their own receipt link sees the last four digits and, if gold there,
      *⭐ Gold*; never their name or full number, proved from the
      payload; a bill with no customer shows neither; the page, the counter view
      and the PDF agree; the service line reads right; the reversal is argued in
      the spec; no receipt link or counter pop-up breaks across the release; and
      the four-role demo walkthrough still walks.
- [ ] 6.5 🧍 The owner opens a real receipt for a bill where a customer gave their
      number at Kalyani Cafe, and shows one from the counter's View receipt. Tasks
      complete is not the archive trigger; real use is.
