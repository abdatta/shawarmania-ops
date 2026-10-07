# The menu orders items and highlights dishes

> **Model**: Opus · **Wave**: F · **Dependencies**: #10, #61

## Why

Managers can move categories but cannot move individual dishes within them. Promoting a few dishes currently requires moving their entire category. Customers should see deliberately ordered dishes and an optional, named selection first.

## What changes

The owner and an outlet's manager can move an item up or down within its category. A separate highlights section appears above the normal categories; selected items remain in their original categories. Its name is editable (for example Newly Launched, Recommended, Best Sellers or Discounted Offers), and its selection and order are editable independently of category order. An empty selection produces no customer-facing section. Removed items disappear; unavailable dishes retain their unavailable label. Each outlet owns its own selection.

The public menu at `shawarmania.in/menu/<slug>/` shows the same item order and the named highlights first, within its existing one-minute cache. A promotion label does not change prices or discounts.

Owner UI feedback also moves the existing counter discount presets entirely off Menu into **Orders** in each outlet's settings, labelled **Bill discount shortcuts**. One through four shortcuts fill one equal-width row, with compact inline addition controls. Orders settings and shortcuts use sibling cards with independent, plainly labelled Save/Cancel actions and matching saved-card glow. This reuses the current preset adapter and persistence; no new schema or money-arithmetic change is required. Category-based discount presentation remains outside this iteration until the owner supplies the desired interaction.

The approved manager layout puts compact Menu Discounts above Highlights and ordinary categories, with short permanent guidance and no separate customer preview. The highlights editor omits the Selected dishes header/count and unnecessary explanation; an empty draft says “No dishes highlighted yet.” Regular category rows use accessible highlight and unavailable symbols, while unavailable actions stay opaque.

## Delivery and gate

Build and verify the UI against the mock first, behind the `menu-presentation` demo part gate. The owner explicitly approved the settled UI on 2026-10-07 (“amazing all lgtm”) and requested specification reconciliation before continuing. That checkpoint is complete; database persistence, tenancy tests, live presentation adapters and public-reader integration remain pending and must preserve the approved UI. Final checkpoint: managers round-trip ordering and highlights through the live app, another outlet cannot read or write them, the customer's menu reflects them within a minute without a website deploy, and the demo still walks.

## Non-goals

Drag-and-drop, moving dishes between categories (the existing Edit does that), automatic best-seller rankings, timed campaigns, automatic discount creation, a shared catalogue, duplicate counter tiles, or changes to captured bills and offline settlement.

## Durable documentation

Update `docs/SCREENS.md`, `docs/DATA_MODEL.md`, `docs/DEMO_MODE.md`, `docs/OPERATIONS.md` and `docs/TESTING.md` before archive. Record the owner's UI decision in design. Do not archive or publish as part of the UI review stage.
