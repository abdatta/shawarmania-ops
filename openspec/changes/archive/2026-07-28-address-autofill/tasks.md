# Tasks: address-autofill

> Read [`proposal.md`](proposal.md) and [`design.md`](design.md) first.
> Decision references (D1–D11) are to that design.

## 1. The seam

- [x] 1.1 `AddressSuggestion` and `AddressLookupAdapter` in `src/data-access/adapters.ts`: `suggest(query, signal)` and `districtForPincode(pincode, signal)`.
- [x] 1.2 **`AddressSuggestion` carries no latitude or longitude** — not optional, not nullable, absent (D3). The type is the enforcement.
- [x] 1.3 Register it on `DataAdapters` alongside the existing adapters, real and mock.

## 2. The real implementation

- [x] 2.1 `src/data-access/supabase-adapters/address-lookup.ts` — the one adapter that talks to neither Supabase nor a key-holding service. Note in the file why it lives here anyway: it is the layer permitted to do I/O.
- [x] 2.2 Photon `GET /api?q=…&limit=6&lang=en&bbox=68.1,6.5,97.4,35.7` (D1, D10). Restricted to India, not merely biased.
- [x] 2.3 Map a feature to a suggestion: line 1 from `housenumber` + `street`, falling back to `name`; line 2 from `locality`; city from `city`; PIN from `postcode`. Drop `district`, `county` and the geometry (D3, D4).
- [x] 2.4 `districtForPincode` against `api.postalpincode.in`, reading `PostOffice[0].District` and treating any non-`Success` status as no answer (D4).
- [x] 2.5 Every network failure resolves to an empty result rather than throwing (D7).
- [x] 2.6 Unit tests against **recorded real payloads** for Central Park Kalyani, Kanchrapara Station and a Mumbai result — including that `district`/`county` never reach the output, and that a missing `postcode` yields no PIN rather than an empty string.

## 3. The mock

- [x] 3.1 `src/data-access/mock/address-lookup.ts` with three fixtures — two Kalyani, one Kanchrapara — matching by substring, resolving with no I/O (D11).
- [x] 3.2 One fixture carries no PIN, so the demo shows a partial fill.
- [x] 3.3 A small fixed PIN → district map for the demo.

## 4. The combobox

- [x] 4.1 `src/components/ui/address-search.tsx` — built to be reused by the employee form later, so it takes a callback and knows nothing about outlets.
- [x] 4.2 ARIA 1.2 combobox: `aria-expanded`, `aria-controls`, `aria-activedescendant`, `role="listbox"`/`option`; arrow keys, Enter, Escape (D9).
- [x] 4.3 300 ms debounce, `AbortController` per request, previous request aborted — a stale response must never replace a newer one (D8).
- [x] 4.4 Zero results says so; every other failure is silent (D7).
- [x] 4.5 Phone-sized touch targets on the options.
- [x] 4.6 Component tests: picking calls back with the suggestion; keyboard selection works; a superseded response does not overwrite; an unreachable lookup renders no error.

## 5. The outlet form

- [x] 5.1 The search sits above the address block in `outlets-surface.tsx`, inside the same `Field`, labelled so it reads as a shortcut rather than a required step.
- [x] 5.2 Picking writes all four address fields, clearing what the suggestion lacks (D5).
- [x] 5.3 The location label is filled only when empty, never overwritten (D5).
- [x] 5.4 District resolution fires after a pick and on PIN edit, and never blocks the fill (D4, D6).
- [x] 5.5 Debounce the hand-typed PIN so a six-digit entry is one lookup, not six.
- [x] 5.6 Component tests: the pick fills; a typed label survives; an empty label fills; a second pick clears the first's PIN; a typed PIN fills the district; every field stays editable afterwards.

## 6. Nothing touches the fence

- [x] 6.1 A test asserting an outlet created through a picked address has `latitude`, `longitude` and `location_captured_at` all null (D3).
- [x] 6.2 A test asserting the mapper's output has no coordinate-bearing key at all.

## 7. End-to-end

- [x] 7.1 A demo e2e case: create an outlet, search, pick, see the fields fill, save.
- [x] 7.2 The demo address walk makes **no request off the app origin**.
- [x] 7.3 The existing "whole setup walk stays inside the app origin" case still passes.

## 8. Docs and verification

- [x] 8.1 `npm test`, `npm run lint`, `npm run typecheck`, `npm run build` green.
- [x] 8.2 `npm run test:e2e` against the production build.
- [x] 8.3 `npm run contrast` and the no-hex check green.
- [x] 8.4 Inspect the combobox on a phone and a tablet viewport, light and dark: keyboard navigation, zero console errors, and the network log showing exactly the two lookups and nothing else.
- [x] 8.5 Exercise the real lookup against the live services from the browser, not only against recorded payloads.
- [x] 8.6 Docs: `docs/SCREENS.md` (the search on the outlet form), `docs/OPERATIONS.md` (step 1 of onboarding), `docs/SECURITY_AND_PRIVACY.md` (two external lookups, what is sent, and that no customer or employee data reaches them).
- [x] 8.7 🧍 Search for your own two shops on a real phone and confirm the addresses that come back are ones you would actually put on an invoice.
