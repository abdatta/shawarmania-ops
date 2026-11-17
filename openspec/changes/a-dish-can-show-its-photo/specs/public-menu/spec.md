## MODIFIED Requirements

### Requirement: The public menu is read through one service-role function

A customer's menu SHALL be read only through a service-role function,
`public_menu_v2(slug)` (and, until the brand site's Worker has moved to it, the
earlier `public_menu(slug)`, which this change leaves untouched), executable by
the service role and by no client role — neither `anon` nor `authenticated` —
exactly as the public receipt is. The brand site's Worker SHALL hold the
credential; no browser SHALL.

It SHALL answer with the outlet's name and address, optional nonempty highlights
first, and ordinary active categories in the counter's saved order. Each section
SHALL use the same existing section shape and each active item SHALL carry its
name, description, price in integer paise, veg flag, whether it is available,
and (from `public_menu_v2`) its photo — and nothing else:
no ids, no other outlet fields, no discounts. An item's photo SHALL be its
content key, image format and large-photo shape (4:3, 1:1 or 4:5) while the
`dish-photos` gate is on and the item has a photo, and null otherwise; the kept
original and the crops SHALL NOT be sent. A removed item SHALL be absent; an
unavailable item SHALL be present and flagged, because the customer should see
what is off today rather than wonder where it went. Beside the sections it SHALL
carry `review`: the outlet's review link, review discount percentage and whether
to open with the popup while the outlet asks for a Google review, and null while it does not.

It SHALL answer null — one answer for all three — for an address no outlet holds,
a closed outlet, and an outlet with nothing on its menu, so nothing can be learned
about which outlets exist.

#### Scenario: A customer scans a table's code
- **WHEN** the Worker asks `public_menu_v2` for a trading outlet's address
- **THEN** it receives nonempty highlights first when configured, then that outlet's ordinary active categories and items in the counter's saved order, each item with exactly name, description, price, veg flag, availability and photo, and the outlet's review ask or null

#### Scenario: The kitchen ran out
- **WHEN** an item is marked unavailable
- **THEN** the public menu lists it, flagged unavailable

#### Scenario: An item was removed
- **WHEN** an item is removed from the menu
- **THEN** the public menu does not list it

#### Scenario: A closed outlet, an empty menu, an invented address
- **WHEN** the Worker asks for any of them
- **THEN** it receives null, the same for all three

#### Scenario: A session tries to call it
- **WHEN** an anonymous request or any signed-in session, the owner's included, calls `public_menu` or `public_menu_v2`
- **THEN** it is refused

#### Scenario: The earlier reader is unchanged
- **WHEN** the Worker published before this change calls `public_menu`
- **THEN** it receives exactly the fields it received before, with no photo

## ADDED Requirements

### Requirement: A dish's photo reaches the customer through the brand site's cache

The customer menu SHALL show a dish's photo only where `public_menu_v2` sends
one. The page SHALL address a photo as `/menu/<slug>/photo/<key>.<format>`
(and `<key>-sm.<format>` for the thumbnail), revealing no id. The brand site's
Worker SHALL fetch a photo from storage only on an edge-cache miss, only after
`public_menu_photo(slug, key)` confirms it is the current photo of an active
dish at that trading outlet while `dish-photos` is on, and SHALL then let
Cloudflare cache it for a year as immutable. A browser SHALL never fetch a photo
from Supabase.

`public_menu_photo` SHALL be executable by the service role only, and SHALL
answer null alike for a key that does not exist, was replaced, belongs to
another outlet, belongs to a removed dish, names a kept original, or is asked
for while the gate is off. A dish's kept original SHALL never be served to a
customer.

#### Scenario: A customer opens a menu with photos
- **WHEN** a photographed dish's page is served
- **THEN** its thumbnail and large image come from `shawarmania.in`, and Supabase is asked for each file at most once per Cloudflare edge

#### Scenario: A photo is replaced
- **WHEN** a manager replaces a dish's photo
- **THEN** the menu links the new key within the cache minute, and the old key is answered 404 by the Worker unless an edge still holds a copy, which no page links

#### Scenario: Another outlet's key
- **WHEN** a request asks one outlet's address for a photo key that belongs to another outlet
- **THEN** `public_menu_photo` answers null and the Worker answers 404

#### Scenario: The gate is turned off
- **WHEN** `dish-photos` is turned off
- **THEN** within the cache minute the menu shows no photos and is the page it was before this change, and every uncached photo request is 404

### Requirement: A photographed dish reads photo first, price in its place

On the customer menu, a dish with a photo SHALL show its square thumbnail on
the left with rounded corners; its name and price SHALL stay on one line beside it, the price
right-aligned in the same column as every other price on the page, the name
wrapping if long; and its description SHALL wrap beside the photo and continue
beneath it. A dish without a photo SHALL read exactly as it did before this
change. Highlights SHALL use the same rows as every other section. A sold-out
dish SHALL keep its photo, greyed.

The photo SHALL carry a small, unobtrusive expand mark and SHALL respond to a
press, and tapping it SHALL open the large photo, in the shape its manager
chose and with its height capped so the dish's name and price stay in view,
with the dish's name, price and description, closed by a close button, a tap outside, Escape or the phone's Back
button. The opening and closing SHALL animate from and to the thumbnail, and
SHALL NOT animate under a reduced-motion preference. A menu with no photos SHALL
carry none of this markup or script.

#### Scenario: A mixed section
- **WHEN** a section holds dishes with and without photos
- **THEN** every price sits in one right-hand column, and the dishes without photos read as they did before

#### Scenario: A long description beside a photo
- **WHEN** a photographed dish's description is longer than the photo is tall
- **THEN** the description continues under the photo rather than leaving an empty column beneath it

#### Scenario: A customer taps a photo
- **WHEN** a customer taps a dish's photo
- **THEN** the photo opens large with that dish's name, price and description, and Back returns them to the same place in the menu
