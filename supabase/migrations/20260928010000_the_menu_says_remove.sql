-- menu-says-unavailable-and-remove: the command is named for the screen's word.
--
-- The Menu screen's permanent action is now **Remove** (it was *Retire*), so the
-- command it calls is `remove_menu_item`. Its body is unchanged: the row is kept
-- because captured order and bill lines refer to it, and a category left with no
-- active item goes with it.
--
-- `retire_menu_item` stays, as a one-line wrapper, for one release. The app is an
-- installed PWA and this migration lands before any counter adopts the build that
-- calls the new name; a tablet still on the previous build must not have a
-- manager's Remove refused in the meantime (design D2). It is dropped by the
-- follow-up recorded in openspec/todos/drop-retire-menu-item.md.

alter function public.retire_menu_item(uuid) rename to remove_menu_item;

comment on function public.remove_menu_item(uuid) is
  'Removes one menu item from the working menu for good, keeping its row for the bills that name it; a category left with no active item is removed with it. Runs under caller RLS.';

create function public.retire_menu_item(p_item_id uuid)
returns void
language sql
set search_path = ''
as $$
  select public.remove_menu_item(p_item_id);
$$;

comment on function public.retire_menu_item(uuid) is
  'Deprecated name for remove_menu_item, kept for installed apps on the previous build. Drop per openspec/todos/drop-retire-menu-item.md.';

-- The rename carried the original grants with it; the wrapper gets the same ones.
-- Neither is security definer, so RLS still decides whose item may be removed.
revoke execute on function public.retire_menu_item(uuid) from public, anon;
grant execute on function public.retire_menu_item(uuid) to authenticated;
