# Proposal: the-demo-bills-like-the-shop

> **Model**: Opus · **Kind**: demo data refresh, not a roadmap change ·
> **Gate**: the demo's two trading outlets carry the real sixty-item menu in its
> ten categories, veg items marked veg; the demo's Kalyani counter bills with the
> owner's own settings — dine-in and takeaway, keyed tables, ₹10 flat packaging
> free for gold, 5 points per ₹200 capped at 5% (30% for gold), gold for six
> months at 1×, billers may upgrade at ₹2,000 a month; the menu search's pinned
> bar is proved against that menu in a real browser; every suite is green with
> each moved figure re-derived, not re-recorded.

## Why

The demo shows a seven-item menu that is no longer what the shop sells, and a
Kalyani counter that has chosen none of the order settings the owner actually
runs [owner, 2026-10-06]. A walkthrough therefore demonstrates neither the menu
search (`billing-menu-search`), which exists because the real menu outgrew one
screen, nor the counter as it really bills.

## What Changes

- The demo menu is Kalyani Cafe's menu as the owner's Menu screen shows it:
  Shawarmas, Burgers, Sandwiches, Appetizers, Main Course, Arabian Favourites,
  Desserts, Tea & Coffee, Mocktails and Water — sixty items with their real
  names, prices, descriptions and veg markers, at both trading demo outlets.
  The seven items the demo always had keep their ids; the four whose names or
  prices moved take the real ones (Classic ₹135, Mayonnaise ₹155, Double ₹175,
  Cheese ₹175, Chicken Shawarma Salad ₹220, Lebanese ₹220, Smashed Chicken
  Burger ₹250). Lebanese stays the one unavailable at Kalyani; the 15% demo
  discount stays on Burgers.
- The demo's Kalyani outlet takes the owner's settings from their Orders and
  Loyalty screens. Kanchrapara keeps per-bag packaging and loyalty off, so the
  demo still shows the other choices.
- Every demo figure that follows from those prices and settings moves with
  them, and every test asserting one is re-derived from the new prices.
- The pinned-search check deferred by `billing-menu-search` lands here.

## Non-goals

- No change to `supabase/seed.sql` or to any real outlet's data.
- No new demo outlet named Kalyani Cafe; the menu is materialised at the two
  demo outlets as before.
- No change to the app's behaviour.

## Docs to update before archive

- `docs/DEMO_MODE.md` — the walkthrough no longer starts Kalyani with nothing
  chosen, and the veg-marker caveat goes.
- `docs/BUSINESS_CONTEXT.md` — the live-menu table.
