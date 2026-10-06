# Design: the-demo-bills-like-the-shop

## D1. The real menu, transcribed, at both demo outlets

The menu was read off the owner's own Menu screen (the brand site was not
reachable from the machine that made this change), item by item: name, price,
description, veg marker. It is materialised at both trading demo outlets from
one blueprint, as before, because the schema has no shared catalogue.

*Rejected:* a third demo outlet named Kalyani Cafe. Every surface that lists
outlets, every persona's assignments and every roster would move with it, to
show one menu the two existing outlets can carry.

## D2. The seven old items keep their ids

An item's id is its position in the blueprint, and fixture bills, tests and
other fixtures point at ids. The seven items the demo always had are first, in
their old order, as the real items they became: Classic, Mayonnaise, Double,
Cheese (was Mozzarella Cheese), Chicken Shawarma Salad (was Healthy),
Lebanese (was Stuffed Lebanese, still the one off at Kalyani) and Smashed
Chicken Burger (was Fully Loaded). Two internal keys follow their items' names
(`cheese`, `lebanese`). On screen, `sortOrder` places them as the owner's menu
does, so the Classic is ninth among the Shawarmas.

## D3. Moved figures are re-derived, and one seed changes to keep its purpose

Every total that follows from a price moved, and each was worked from the new
prices rather than copied from a run. One seed bill changed shape: the demo
day's discounted sale was two Mozzarella at ₹199, whose 10% left paise for the
round-up line to round. Two Cheese at ₹175 is ₹350, whose tenth is whole, so it
is now three: ₹525, less ₹52.50, carried from ₹472.50 to ₹473.

## D4. Tests about something else say "nothing chosen" themselves

With dine-in and takeaway both offered, every order at the demo's Kalyani waits
for a service type. The counter's unit tests already render "all-off unless a
test asks otherwise"; the settings page's tests now clear Kalyani's choices
first, and the counter's browser tests do so through the owner's Orders switch
(`openCounterWithNothingChosen`). A test about service types uses the demo as
shipped, and one new browser test rings a takeaway the way the shop does: the
type asked for, ₹10 flat packaging, waived for a gold member.

*Rejected:* teaching every counter test to pick a service type. It would make
every unrelated total carry ₹10 of packaging or a table, and a test whose
figure moved for a reason it never mentions is a test nobody can read.

## Money, tenancy, offline

No schema, policy, arithmetic or outbox change. Fixture data only.
