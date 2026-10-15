# Design

## Exploration

Baseline: clean main at `0732ba11`, equal to fetched origin/main on 2026-10-06. MenuSurface reads `MenuAdapter.readOutletMenu`; categories already have Move up/down, items do not. Both adapters sort items by `sort_order`, then name. The counter sells from ordinary categories and snapshots item prices. `public_menu` orders items by sort order/name/id and returns only public fields. The brand website Worker (`C:/Users/iamro/Code/shawarmania/worker/src/menu.ts` and `menu-page.ts`) renders generic sections in supplied order, caches for one minute and accepts the existing section/name/items shape. Prepending an ordinary section needs no website implementation change. This concerns the live outlet menu, not the static marketing site's separately maintained menu JSON.

Orders (#60) and Loyalty (#62) establish the delivery pattern: mock implementation, explicit owner checkpoint, then migrations and live adapters.

## D1 — One item, two places to discover it

Highlights are ordered references to existing dishes, preserving their category, price and availability. The manager page shows Menu Discounts, then Highlights, then ordinary categories. The customer menu shows highlights first. Highlights neither duplicate counter tiles nor change discount matching.

The compact card has a sparkle, configurable title, permanent subtitle “Highlight dishes at the top of your menu.” and Edit beside them. Populated selections add dishes below; an empty card has no empty-state panel or preview action. Share remains the public-menu entry point. On a 390×844 phone with no discounts or highlights, the card is at most 72 px high and the first ordinary category begins above the viewport midpoint. Menu Discounts has “Category or whole-menu discounts.” below its title, beside Add Discount without wrapping the button.

Edit highlights has an inline Section name label and input, followed by selected names with up/down/remove actions on each row. There is no visible Selected dishes heading or count, introductory guidance, title examples, repeated prices or ordering explanation. An empty draft shows one normal-weight line: “No dishes highlighted yet.” Search reads “Search dishes or categories”, with an accessible Choose dishes label and grouped dish choices carrying prices, dietary markers and availability. With two selected dishes, search begins within 300 px of the dialog top on the reviewed phone viewport. Save highlights commits title and ordered selection together; closing without saving discards the draft. Default title: Highlights, trimmed, required and at most 60 characters. Names such as Newly Launched, Recommended, Best Sellers and Discounted Offers do not themselves apply discounts.

Regular category rows identify highlighted dishes with the existing sparkle, accessible Highlighted label and hover title. Do not repeat it inside the highlights list. Unavailable regular rows use a crossed-circle with accessible Unavailable label and hover title in place of the text badge; both symbols may coexist. Only item details are muted; the action trigger and dropdown stay fully opaque. Unavailable dishes retain their selection. Removed dishes and inactive categories are filtered on reads; a removed identity cannot return as another newly created dish.

## D2 — Reordering must work even when positions tie

Move up/down restates the active category's complete ordered item identities, normalizing positions to consecutive integers. Separate swaps of tied sort numbers can do nothing or leave a partial order. The live command locks the category, checks its complete active membership and writes atomically under existing manager authority. Stale membership fails visibly without a partial write and prompts a refresh. First/last directions are disabled. Category membership, prices, availability and captured lines are unchanged.

## D3 — Approved UI and the delivery boundary

The owner explicitly approved the settled UI on 2026-10-07: “amazing all lgtm”, then requested specification reconciliation before implementation continues. The UI checkpoint is complete. The owner resumed in this session after the branch checkpoint. Persistence, live presentation and public-reader integration now implement this approved target; all local gates now pass. Production publication remains separate from this branch implementation.

`menu-presentation` is now a live part gate. The typed optional `presentation` boundary is implemented by both mock and live adapters. The demo store owns per-outlet title and ordered existing-schema item IDs across navigation and persona switches. Do not invent generated schema to make the UI look live. Promotion follows database/REST round-trip evidence; the same approved controls now render in real and demo modes. Outlet changes clear loaded presentation state and close drafts. Shimmers reserve the compact menu cards and two sibling Orders cards in both themes.

## D4 — Live implementation

Two tables persist the configuration: menu_highlight_sections owns the outlet and title, and menu_highlight_items owns ordered references. Both have scoped RLS reads; client table writes are revoked. A composite menu-item/outlet foreign key holds same-outlet identity for each reference. The atomic set_menu_highlights command checks the caller’s live owner/manager authority, validates distinct active dishes and replaces title/selection together. read_menu_highlights uses one statement snapshot and filters removed dishes/inactive categories. Generated types come from the fresh reset schema; the domain configuration uses its title/item identity types. reorder_menu_items locks the category and items and normalizes the complete active order, rejecting stale membership. Item identity breaks equal position/name ties consistently in live and demo reads.

The service-role public reader prepends nonempty highlights using the existing public item projection and section JSON contract. It retains ordinary categories and their saved item order, includes unavailable flags, and omits removed dishes, inactive categories and empty highlights. Preserve its exact field allowlist, privilege boundary and indistinguishable null responses. Verify representative output against the actual Worker renderer, including a title equal to an ordinary category, whose distinct anchors must still work. The existing cache means edits reach `shawarmania.in/menu/<slug>/` within a minute without a website deployment.

## D5 — Bill discount shortcuts belong to Orders

Move all preset configuration off Menu into the existing Orders section of the outlet settings page, labelled Bill discount shortcuts. Reuse `menu.readOutletMenu(outletId).presets` and `menu.setDiscountPresets`; existing live persistence and authority remain. No migration or money-arithmetic change is required for the relocation. Category-based menu-discount redesign is explicitly deferred.

Orders contains two sibling cards: customer/service/packaging settings and their footer first, then shortcuts and their own footer. There is no enclosing Orders footer after shortcuts. Both cards use plain Save and Cancel; card boundaries identify their scope. Each command, draft, cancellation and error is independent, including when both cards are dirty. The existing Orders/Gold visual style is retained through alternating surface tones, rounded tiles, percentage icon and shared SaveBar feedback.

One through four removable shortcuts span a single full-width row with equal columns, including on phones. Each shows its value and trash symbol, with the complete accessible value and title. Below them, Value, compact %/₹ selector and labelled plus action share one row; the addition row disappears at four. No shortcuts shows “No shortcuts set.” Retain existing positive finite value validation, percent limit, conversion to integer basis points/paise and duplicate rejection. Preset, input, unit and Add controls have an explicit 44 px minimum height. The default three-shortcut tile is at most 180 px high on phone and tablet, with no horizontal overflow.

Save commits the full ordered shortcut configuration; cancellation restores it and clears an unfinished addition. Refused saves retain the draft and a retryable error. Success uses the same Saved confirmation, settling/fold timing and `motion-safe:animate-[saved-glow_1.6s_ease-out]` as the other settings. The shortcut component owns the outer card; drafts, cancellation and failed saves do not glow, and reduced motion suppresses animation. Mount only for a visible active outlet, expose writes only to the owner/assigned manager, and reset drafts on outlet changes. Loading/read-only/error states retain the card structure.

## Security, money and offline

New persistence ships RLS and database/REST isolation proofs in the same stage. Client sessions cannot call the public service-role reader, and no service-role key enters the browser. Money arithmetic, historical lines and the outbox are unchanged. Ordinary category order continues to feed the counter; highlights affect discovery only.

## Alternatives rejected

- Moving promoted dishes into a real category changes grouping and discount coverage.
- Cloning dishes creates price and availability records that drift.
- Drag-and-drop is unnecessary for this interaction; explicit moves match category controls.
- A global campaign would cross outlet boundaries.
- A new public JSON field would require an unnecessary Worker deployment and allowlist change.
- A separate preview duplicates Share; a preset sheet and nested save footers consume space and obscure scope.
