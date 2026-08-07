# Proposal: expense-categories-grow-from-use

> **Model**: Opus · **Wave**: D · **Depends on**: #2, #36 · **Gate**: a category typed once at one outlet is offered from then on at both; the month groups by the text the row stored, so a rename reaches new rows only until the owner deliberately rewrites history; a merge collapses two spellings across every past month and its log says what it moved; the nine production rows arrive carrying `Hyperpure`, `Chicken` and `Staff Food` as their categories with the note left free for detail; and neither `manual_ledger_expenses` nor `expenses` still reads the enum.

## Why

**Production says the enum is the wrong model, and says it unambiguously.** On 2026-08-07 the manual ledger held nine expense rows across six trading days at both outlets, worth ₹79,528. **All nine are `raw_materials`.** The eight-value `public.expense_category` enum is carrying one bit of information.

What the owner actually recorded is in the "What was it for" field, and there are three distinct values across the nine rows: `Hyperpure`, `Chicken`, `Staff Food`. Seven, one and one. They are 7 to 10 characters long, and the case-insensitive and case-sensitive distinct counts are both 3, so there is not a single spelling variant to clean up. **These are category names. They have been category names since the ledger shipped**, written into a free-text field because the category field could not hold them.

So the month's "expenses by category" breakdown, which exists to answer where the money went, currently answers `raw_materials: ₹79,528` and nothing else. The information to answer it properly is already in the database, in the wrong column.

The second reason is timing. `expenses` (#2) uses the same enum and is demo-gated, so it holds **no production rows**. Converting it costs nothing today and costs a data migration once #11 promotes it. And #12 inherits an obligation that says the manual ledger's rows carry across with "no translation table" precisely because both sides share the enum; leaving one side on it quietly breaks that promise for whoever picks #12 up.

## Scope

**A business-wide category list.** One table, not outlet-scoped, so a manager opening the third outlet inherits every category the business already uses rather than starting from an empty dropdown. `customers` is the existing precedent for a business-wide table here, and its isolation tests are the shape to follow.

**The expense row snapshots the category text.** The list powers suggestions and nothing else. This is the rule bill lines already follow for `item_name` and `unit_price`: renaming a category must not silently relabel four months of history, exactly as a price change must not rewrite last month's revenue. It also means retiring a category orphans nothing.

**Typing is the primary interaction.** Focus the field and it offers recent categories; type and it filters. A new word is accepted and joins the suggestions from the next entry onward. Anyone who may record an expense may mint a category, because the person holding the receipt is the person who knows what it was.

**Deterministic normalisation, applied without asking.** Trim, collapse internal runs of whitespace, and match case-insensitively so `chicken` finds `Chicken` and never creates a second entry. Applied to matching and to storage.

**Owner-only curation: rename, merge, retire.** Rename and merge are the deliberate retroactive rewrites that snapshotting makes possible rather than automatic. Each one writes a single log row recording from, to, how many expense rows moved, when, and by whom, readable from the curation surface. The manual ledger is a notebook where a wrong figure is retyped without history, and that stays true of one row; restating four months of category totals across two outlets is a different act, and one small table is the whole price of being able to explain it later.

**A soft warning, not a refusal**, when a typed category looks like aggregator commission, cash banked or an owner drawing. The `manual-ledger` spec forbids these because each is accounted for elsewhere and a category for one would double-count it. A hard block on free text is routed around by spelling; a sentence explaining that cash taken from the drawer belongs on the day rather than in expenses teaches the rule.

**`description` becomes optional and is relabelled `Note`.** It is mandatory today because "a category and an amount identify a purchase for about a week". A free-text category now carries that meaning, so the requirement moves rather than disappears, and the note is free for detail like `200 kg`. Making somebody type the same word twice is how a fast surface becomes one people avoid.

**The migration.** Promote the "What was it for" text to the category column on all nine production rows, seed the list with the three distinct values, and leave the note free. Convert `expenses` in the same migration while it is empty.

## Non-goals

- **No outlet-scoped categories.** The list is business-wide by decision; a category is a kind of cost, not a property of a shop.
- **No supplier field.** Production shows the owner using a supplier (`Hyperpure`), a good (`Chicken`) and a kind of cost (`Staff Food`) interchangeably as categories. **The owner has accepted the mix** (2026-08-07): at this volume the month is still readable, and a merge migrates it later if it stops being. Do not design a second axis here.
- No spend limits, budgets or per-category thresholds.
- No category hierarchy or nesting.

## Design questions to settle during `/opsx:propose`

- **Whether the column becomes `text` or a foreign key with a snapshot beside it.** Snapshotting is settled; the storage shape that makes the merge query honest is not. A plain `text` column plus a separate suggestions table is the simpler read, and it makes "the list is only suggestions" true rather than merely stated.
- **What retiring a category does to a category still present on historical rows.** It must vanish from suggestions and leave every stored row untouched, which the snapshot makes possible, but the curation surface has to show that history still holds it.
- **Whether the operation log is its own table or a column on the category row.** A merge deletes one of its two inputs, so a column on the row cannot survive the operation it describes.
- **Whether a merge is reversible**, and if not, what the confirmation says. It rewrites months across both outlets.

## Watch out for

- **The generated types diff.** Changing a column off an enum on two tables regenerates `database.types.ts`, and `typecheck` cannot detect a stale snapshot. Run `db:types` and stage the result.
- **The `manual-ledger` spec forbids three categories by name.** That requirement was written against a closed list. It survives as a warning rather than a guarantee, and the spec delta must say so plainly rather than leave a requirement the code no longer enforces.
- **The month's grouping is the actual deliverable**, not the dropdown. A change that ships suggestions and leaves the month grouping by a snapshot it does not normalise has shipped the easy half.
- **`expenses` is demo-gated, so its conversion is unverifiable by using it.** The isolation tests are what prove that half landed.

## Docs to update before archiving

`docs/DATA_MODEL.md` (the expense category model, and the business-wide table alongside `customers`), `docs/SCREENS.md` (the curation surface), `docs/ROLES_AND_PERMISSIONS.md` (who may mint and who may curate), `docs/LIMITATIONS.md` (the three forbidden categories are now a warning).
