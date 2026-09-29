# Drop the `retire_menu_item` wrapper

**Trigger:** every counter tablet and manager phone has adopted a build that
calls `remove_menu_item` — in practice, a week after
`menu-says-unavailable-and-remove` deploys, confirmed from the build stamp in
each counter's footer.

## What is left behind

`menu-says-unavailable-and-remove` renamed the menu's permanent action from
*Retire* to **Remove**, and the database command with it. The old name was kept
as a one-line wrapper (`supabase/migrations/20260928010000_the_menu_says_remove.sql`)
because an installed PWA keeps running the build it has until it adopts the
update, and the migration lands first.

## The change

One migration: `drop function public.retire_menu_item(uuid);`, and the
`27_live_menu.sql` assertion that the wrapper still removes an item goes with it.
