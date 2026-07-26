# Features layer

One folder per domain area — `billing`, `attendance`, `inventory`, `expenses`, `cash`, `menu`,
`reports`. Each owns its components, hooks, and types.

Rules:

- A feature depends on the **typed adapter interface** from `src/data-access`, never on the
  Supabase client. A feature that imports `@supabase/supabase-js` has broken the seam and lint
  will reject it.
- Counter writes go through `src/outbox`, never straight to an adapter. The counter never blocks.
- Money arithmetic belongs in `src/domain`, not here. Features render results; they do not
  compute totals.

Empty until `demo-mode-and-app-shell` (#3) establishes the adapter seam and the gate registry.
