# Repair: the people already deactivated (design D7)

Production on 2 November 2026, read-only, before the Promote: every profile with
`is_active = false`, which is every one with no `deactivated_at` (the column did
not exist yet).

| Person | Profile | Outlets | Last attendance | Last sign-in | Day agreed |
| --- | --- | --- | --- | --- | --- |
| Naresh | `d3807733-56ee-4025-9c86-1334092d5be8` | Kalyani ended 27 Sep; Kalyani Cafe live | 1 Oct by phone (1 Nov was a mistake, below) | 30 Jul | **27 Oct 2026, 23:00**: switched off that night, the owner recalls |
| Arpita | `3d432bb8-a831-49c7-bcc0-9c4db6fde189` | none live (Kalyani ended 27 Sep) | 9 Sep | 12 Aug | **9 Sep 2026, 21:00**, after her last attendance; she has left, so it is bookkeeping |

Naresh's October had no phone check-ins after the 1st: attendance was not
enforced that month (owner). The moment is recorded since design D10: at 23:00
on 27 Oct, after Kalyani Cafe's 13:00 deadline and before the 04:00 cutover, so
the 27th is his to have missed: his rowless days up to the 27th read absent and
nothing shows from the 28th.

## Done on 2 November: Naresh's 1 Nov entry removed

A manager marking everybody present on 1 Nov included Naresh by mistake (owner).
A correction would have kept the day listed as absent, so on the owner's word the
day was removed outright: one `attendance` row, its one `manual` attempt and its
one `manual_present` decision, in one transaction with `session_replication_role
= replica` for that transaction alone, each delete required to touch exactly one
row:

```sql
begin;
set local session_replication_role = replica;
-- attendance_decisions 08e9ac98-4ba0-4995-a76b-5209794eba20,
-- attendance_attempts  b035d875-4bb6-40e0-b6d7-7b7e2ffcc7a8,
-- attendance           3acf80b2-79a5-411e-a428-0f5d36d0f4d3,
-- each also filtered by person and business date 2026-11-01.
commit;
```

Checked afterwards: no row left for that day, no attempt or decision without its
day, no day pointing at a missing attempt, `attendance_no_delete` enabled, and
Naresh's last recorded day 1 Oct.

## After the Promote, before `deactivate-then-leave` is turned on

Shown to the owner before it runs:

```sql
begin;
update public.profiles set deactivated_at = timestamptz '2026-10-27 23:00+05:30'
 where id = 'd3807733-56ee-4025-9c86-1334092d5be8' and not is_active and deactivated_at is null;
update public.profiles set deactivated_at = timestamptz '2026-09-09 21:00+05:30'
 where id = '3d432bb8-a831-49c7-bcc0-9c4db6fde189' and not is_active and deactivated_at is null;
commit;
```

Re-run the inactive-profiles read first: anybody deactivated between this list and
the Promote carries no day either, and is added here before it runs.

**Done on 3 November**, after Promote 41595499414 and Deploy 41595619417 on
`0fe6beed` (07:20 UTC), the owner having agreed both moments: the
inactive-profiles read again found the same two and nobody else, both gates off;
the statement above ran in one transaction, each update required to touch
exactly one row. Read back: Naresh `2026-10-27 17:30:00+00` (23:00 IST), Arpita
`2026-09-09 15:30:00+00` (21:00 IST).
