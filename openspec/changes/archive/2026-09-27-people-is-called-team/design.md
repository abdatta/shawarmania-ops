# Design: people-is-called-team

## Decisions

### D1. The address moves, and the old one is not kept

The registry entries become `owner-team` and `admin-team` with `path: 'team'`,
and the route table serves `AccountsSurface` at `team`. `people` is no longer a
route, so it answers with the app's ordinary not-found.

**Rejected: keep the address `people` behind a Team label.** A URL is read too —
in the address bar, in a shared link — and would keep the ambiguity the rename
removes.

**Rejected: redirect `people` to `team`.** Built first, and removed on the
owner's word (2026-09-26): the address was never shared, so there is no link or
bookmark to keep working, and a redirect would be a second name for the screen
kept forever for nobody.

### D2. Only the screen's name changes

Replacements are made by reading each occurrence, not by pattern: "People" is
replaced where it names the screen, and kept where it is ordinary English, an
identifier, or history (proposal, *Non-goals*). The list of kept occurrences is
recorded in `tasks.md` so the final search can be checked against it.

### D3. Spec deltas follow `people-shows-names-first`

That change modifies *Admins manage accounts from a task-based surface scoped to
their authority* and adds *People shows its people before their sign-in
details*. Both are restated here from its delta, so it must archive first; this
change then renames the added requirement and restates the modified one.

No RLS, money or offline semantics are touched.
