# Design: Resilient Counter Departure And Day Close

## Context

The tablet is authenticated as enrolled hardware; the person standing at it is
the attribution selected by a live shift. Those clocks can diverge while the
tablet is offline. The server knows the exact remote `ended_at`; the tablet only
knows its last successful shift read. A solution must keep taking money without
inventing certainty about who physically touched the tablet.

Finish Day currently mixes four unrelated conditions into thrown strings: local
delivery, server orders, the live shift, and a five-minute edit convenience. The
screen renders the string below the header, so the person cannot inspect the
blocking records or understand whether waiting, reconnecting, or correcting is
required.

## Decisions

### D1. A finish attempt opens a sheet before it decides

The first tap opens a sheet in `checking` state and starts one drain attempt plus
authoritative reads. The sheet then lists unsent/retrying local commands,
needs-attention commands, open orders, unavailable server authority, and recent
editable payments. Each hard blocker names its resolution; recent payments are
advisory only.

No blocker is inferred from the owner's heartbeat. The tablet reads its own
IndexedDB and asks the server because those are the two authorities that can
decide the action.

### D2. The tender window is advisory, and Finish Day closes it

An otherwise ready sheet with recent payments offers **Review recent payments**,
**Finish day now**, and **Keep billing**. Finishing writes the server confirmation
and ends the shift with `ended_reason = 'day_finished'`. Any correction created
after that instant is refused even if an old browser view still offers it.

Waiting five minutes was rejected because delivery already starts immediately
and the edit window exists to correct convenience mistakes, not to protect an
uncommitted transaction. A generic Finish anyway was rejected because it would
also read as permission to bypass genuine delivery or order blockers.

### D3. Remote departure and deliberate day finish are different end reasons

`operator` continues to mean the phone holder remotely left or a confirmed
handover replaced them. `day_finished` means the tablet deliberately completed
its date. `device_removed` remains permanent revocation. This distinction is
stored rather than inferred from which UI was probably used.

The phone card says **Leave counter** and confirms that authority ends
immediately; it recommends Hand over at the tablet for an ordinary change and
warns that offline later sales retain flagged last-known context.

### D4. Device delivery lives above the live-shift screen

One subscription is mounted for the enrolled device at `CounterRoot`, independent
of whether `CounterShell` renders Billing or Shift request. The adapter retains
its existing listener reference count, leader lock, retry policy, and reporter.
The no-shift screen still exposes no compose, order, expense, or correction
controls. Replaying immutable work is not new counter authority.

### D5. The server accepts only the precise remote-departure gap

For a command referencing shift S at immutable creation time T:

1. T before S `ended_at` follows ordinary historical validity.
2. T at/after an `operator` end is accepted only while T is before S expiry and
   before another shift on that tablet opened.
3. T at/after `day_finished`, at/after removal, at/after cutoff, or at/after the
   next shift opening is permanently refused.

The command receipt stores `recorded_after_shift_end` and the snapshotted
`shift_ended_at`. Accepted bill results copy both fields onto the immutable bill.
The actor and shift remain S's person and S; they are last-known context, not an
unqualified assertion that the person physically performed the act.

### D6. Money is accepted; attribution confidence is reviewed separately

A flagged bill receives its ordinary server bill number, contributes to revenue
and drawer arithmetic, and is not a delivery blocker. Manager/owner billing
history labels it with operator, tablet time, remote departure time, and review
state. It is absent from the incoming operator's My Shift because its shift id
never changes.

An append-only `billing_attribution_reviews` record has one current resolution
per bill enforced by uniqueness, while the bill and original receipt remain
unchanged. Outcomes are `confirmed_original`, `assigned_other`, and
`operator_unknown`. The reviewing account and instant are always stored.
`assigned_other` does not rewrite `biller_profile_id`; readers show original
context and reviewed outcome side by side.

### D7. Priya inherits the device, never Rahul's responsibility

Opening Priya's shift changes no prior command, bill, flag, or review. Background
drain continues silently. Priya gets no modal, badge, or acknowledgement for
Rahul's exception. The ordinary sync indicator may still report device network
health, and Finish Day may state passively that earlier flagged bills are included
and await manager review, but they do not block her closing.

### D8. Deferred money guards validate as database invariants

The bill-payment equality trigger is deferred until transaction commit. At that
instant a remotely ended tablet shift no longer grants the caller read access to
the bill or allocations it just wrote through the command boundary. An
invoker-security guard therefore mistakes hidden rows for missing rows and
rejects valid money. The trigger function runs with owner security and has no
client execute grant, so it validates the physical table state independently of
RLS without exposing any read or write capability to the tablet.

## Migration and rollback

The forward migration adds nullable/defaulted audit columns, expands the shift
end check, creates the review table and policies, replaces the command helpers,
and replaces Finish Day. Existing rows default to unflagged. No historical row
is guessed from timestamps because an old late sync is not proof of a post-leave
local creation.

Rollback of the UI may hide the new states without losing them. The forward
schema remains compatible with the old readers. The new server acceptance must
not be rolled back while flagged local work may still be draining.

## Verification strategy

- Database tests pin all timestamp boundaries, exactly-once replay, bill flag
  propagation, financial inclusion, review authority, cross-outlet refusal, and
  `day_finished` correction refusal.
- Unit/component tests pin readiness classification, advisory tender behavior,
  phone confirmation copy, no Priya alert, persistent root subscription, and
  manager review rendering.
- Browser tests run phone and tablet paths, offline capture after remote leave,
  reconnect, new shift, background drain, and Finish Day in both themes.
- The full migration, RLS, auth, generated-type, and application gate set runs.
