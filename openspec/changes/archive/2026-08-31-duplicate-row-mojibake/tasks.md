## 1. Pin it before fixing it

- [x] 1.1 Assert in `zomato-channel.test.tsx` that the possible-duplicate row's
      rendered text contains no `Â`. Run it against the unfixed file and watch it
      fail, so the assertion is known to be able to see the bug.

## 2. Fix

- [x] 2.1 Replace the two `Â·` with `·` in `sync-event-row.tsx`.
- [x] 2.2 Strip the file's UTF-8 byte-order mark — the fingerprint of the write
      that caused this, and the only BOM on a source file in the repo.
- [x] 2.3 Re-run the assertion and watch it pass. Then revert the fix, watch it
      fail again, and restore: the proof is the revert, not the reasoning.

## 3. Gate

- [x] 3.1 `npm run typecheck`, `npm run format:check`, and the Zomato and Swiggy
      channel suites. Not the full suite — CI runs it across three parallel jobs
      and gates the publish on it.
- [x] 3.2 Confirm no other source file carries the pattern or a BOM, and say
      what was found rather than assuming the file was alone.
