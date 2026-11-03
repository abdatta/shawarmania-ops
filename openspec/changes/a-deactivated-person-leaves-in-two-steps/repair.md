# Repair: the people already deactivated (design D7)

Production on 2 November 2026, read-only, before the Promote: every profile with
`is_active = false`, which is every one with no `deactivated_at` (the column did
not exist yet).

| Person | Profile | Outlets | Last attendance | Last sign-in | Day agreed |
| --- | --- | --- | --- | --- | --- |
| Naresh | `d3807733-56ee-4025-9c86-1334092d5be8` | Kalyani ended 27 Sep; Kalyani Cafe live | 1 Oct by phone (1 Nov was a mistake, below) | 30 Jul | **27 Oct 2026, 09:00**: the owner remembered switching him off that day; the time is before the deadline unless the owner recalls later |
| Arpita | `3d432bb8-a831-49c7-bcc0-9c4db6fde189` | none live (Kalyani ended 27 Sep) | 9 Sep | 12 Aug | **9 Sep 2026, 21:00**, after her last attendance; she has left, so it is bookkeeping |

Naresh's October had no phone check-ins after the 1st: attendance was not
enforced that month (owner). The moment is recorded since design D10: before
Kalyani Cafe's 13:00 deadline on 27 Oct his rowless days up to the 26th read
absent and nothing shows from the 27th, as a deactivation that morning would.

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
update public.profiles set deactivated_at = timestamptz '2026-10-27 09:00+05:30'
 where id = 'd3807733-56ee-4025-9c86-1334092d5be8' and not is_active and deactivated_at is null;
update public.profiles set deactivated_at = timestamptz '2026-09-09 21:00+05:30'
 where id = '3d432bb8-a831-49c7-bcc0-9c4db6fde189' and not is_active and deactivated_at is null;
commit;
```

Re-run the inactive-profiles read first: anybody deactivated between this list and
the Promote carries no day either, and is added here before it runs.
