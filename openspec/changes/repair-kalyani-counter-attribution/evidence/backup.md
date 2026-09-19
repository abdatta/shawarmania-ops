# Backup and restore evidence

## Logical backup

The pre-change production backup is stored outside the repository at:

`C:\Users\iamro\ShawarmaniaBackups\2026-09-17-kalyani-attribution-repair`

The directory has inheritance removed and grants full access only to the
current Windows identity. No dump content is tracked in Git.

| Artifact | Completed (UTC) | Bytes | SHA-256 |
|---|---|---:|---|
| `production-full.dump` | 2026-09-16T23:37:08Z | 2,944,053 | `C1D243132CB8457C693226C79C61CD002BEDE32861898AEC8F4F6BA9A5D32731` |
| `application-public-auth.dump` | 2026-09-16T23:38:58Z | 2,440,754 | `AFF25C05C9A957F54081EF01B055FF7FCD0561E4E4F05FB6A2CDBA03BF17A962` |
| `roles.sql` | 2026-09-16T23:39:10Z | 7,623 | `49B9C8B7FC3236611A82FD2C47BD85A90EA7F6415FA07DC5984B48211EFAA56A` |

`pg_restore --list` accepted both custom archives. The complete application
archive (schema plus `public` and Auth data) restored with `--exit-on-error`
into the isolated PostgreSQL database `shawarmania_restore`.

## Restore proof

The same UTC-normalized aggregate/fingerprint query was run independently on
production and the restored database. It matched byte-for-byte for all frozen
facts: 37/43/41 bills and children, 39/45 orders and children, 115 commands,
five expenses, 906,000 paise total, 741 earlier Kanchrapara bills, source and
target counters 778/989, and the three SHA-256 row-set hashes in
`baseline.md`. The restored device/shift/assignment facts also match the
production preflight recorded there.

## Retention

- Keep the comprehensive logical snapshot under the normal production backup
  retention policy.
- Keep the targeted before-image and generated reversal through the first real
  Kalyani tablet use and the following business-day acceptance check.
- After both checks pass, securely remove the targeted sensitive bundle and
  retain only these checksums and outcome evidence.

## Expanded targeted rehearsal bundle

The current dependency-complete version-3 bundle was generated at
`targeted-bundle-v3` beneath the external backup directory after the restored
production plan passed. Its before-image checksum is
`2a184e5293ccb6d774b9a401d9f68c49a4969916ef1206382dc11629ef5708a4` and its
time-stable plan digest is
`807fb5e9340120c114a98d2f947622ff48b64186ab2d159dfc3232647b1aa8e8`.
It includes the full reviewed catalog manifest, empty scoped row sets for every
required-absent dependency, and the incident shift's stored expiry. Canonical
hashing covers timestamp values explicitly. Apply, fresh-process verify,
database-only rollback, pre-expiry closure at transaction time and post-expiry
closure capped at stored expiry all passed against isolated full-dump clones;
rollback matched every before-image row and retained issued number high-water
marks as designed.

## Final pre-cutover backup after later Kalyani trade

Because Kalyani traded after the first snapshot, a new three-part production
backup was taken outside Git at:

`C:\Users\iamro\ShawarmaniaBackups\2026-09-18-kalyani-attribution-repair-final`

Inheritance is removed and the current Windows identity is the only granted
principal. This is the authoritative full backup for the amended cutover.

| Artifact | Completed (UTC) | Bytes | SHA-256 |
|---|---|---:|---|
| `production-full.dump` | 2026-09-17T19:37:12Z | 3,015,388 | `FF8AB10F155967C732EB1E38A9D8B07431B28BA533606A214DF9B9B83132C2D8` |
| `application-public-auth.dump` | 2026-09-17T19:39:28Z | 2,507,779 | `50759E4E8426C2042F1AADC3998D52A18C26DF5CD97F3FD1DC8376D61D0C3368` |
| `roles.sql` | 2026-09-17T19:39:40Z | 6,173 | `9E60E0F07B9B88F2D262EB6B23F01D4BE840F263477342C6A435351228E77316` |

The full dump restored into isolated database
`shawarmania_inventory_restore_final4`. The two restore diagnostics were the
known non-application permission refusals for Realtime's `log_min_messages` and
`vault.secrets`; the complete `public` and Auth application graph restored and
the amended plan reproduced every frozen incident and later-Kalyani fact.

The current reviewed rehearsal-only targeted bundle lives beneath that backup
root at `rehearsal-reviewed-v3`. Its plan digest is
`2ddd9538e42cb0141885db927d471a6d74ecc58a6654ac4622db9f954ba4b5a2`
and before-image checksum is
`ba3f289719bb076670bffac702395efd36e0d8835aa6360b8976b94222203e91`.
The final production targeted bundle is deliberately not captured until the
last production plan passes under the closed-counter freeze.

## Finance/history follow-up backup

A new read-only three-part snapshot was taken after the attribution cutover and
before the follow-up schema/data work. It is stored outside Git beneath the same
restricted backup root at `finance-history-followup`.

| Artifact | Completed (UTC) | Bytes | SHA-256 |
|---|---|---:|---|
| `production-full.dump` | 2026-09-17T23:33:39Z | 3,015,422 | `268A602DC20889B3B18278CC9BD13F7FC7CE40A5B90D5EBAC63542230D641D4E` |
| `application-public-auth.dump` | 2026-09-17T23:35:42Z | 2,508,474 | `9A7774D601A8A90B0FC2509F6C3B10231C6524D900B75CE78EF3040F8DB4B8A1` |
| `roles.sql` | 2026-09-17T23:35:54Z | 7,623 | `F11C81168964E8238AAA517605F824F96BCDA1D770D37D7A4E062BD806472532` |

Both custom archives pass `pg_restore --list`. The application archive restored
with `--exit-on-error` into isolated database `repair_followup_final_20260918`;
the temporal migration then applied cleanly on that production state. The
scratch-only targeted rehearsal bundle beneath `finance-history-followup` has
plan digest `d4d12edc98dd289ecf1b8de32b71168a6013ef275b6866108490786ce75e119c`
and checksum
`5d2f7dc92d6c4809cc81bcf470090588da42d95bc2f5b5fd2fbb6a53bc137811`.
It is rehearsal evidence, not the final production before-image; production
capture remains a distinct post-deploy step.

## Targeted-artifact retirement — 2026-09-19

Task 1.4 kept the targeted bundles through first-use and next-day
acceptance. Both checkpoints passed (see `next-day.md`), so task 8.4
securely removed every targeted before-image and generated reversal from
both restricted backup roots, retaining only the non-sensitive checksums
below. Each file was overwritten with random bytes of equal length, then
truncated and unlinked.

Every production before-image checksum below was re-verified against the
value already recorded in `cutover.md` and `finance-followup.md`
immediately before removal, and all three matched.

The full logical snapshots are **kept** under normal backup retention:
`production-full.dump`, `application-public-auth.dump` and `roles.sql`
in both roots, plus the small decision/pin notes and `SHA256SUMS`.

| Root | Retired artifact | Bytes | SHA-256 |
|---|---|---:|---|
| `2026-09-17-kalyani-attribution-repair` | `cutover-debug/before-image.json` | 668928 | `487c20e758c9d4dbee2a65865e70f3faf40d54b4cd1f17fc7f50354e475baaa4` |
| `2026-09-17-kalyani-attribution-repair` | `cutover-debug/reversal.sql` | 220650 | `a9548c4479e0121c1b0e638bf505227bf662c464ea2cacb8b58d6d0e1a406fac` |
| `2026-09-17-kalyani-attribution-repair` | `scratch-rehearsal-second/before-image.json` | 232501 | `e02550f189814c3c17ce3746ae1dd922eb9fc469efc7d248354399f11e819d6e` |
| `2026-09-17-kalyani-attribution-repair` | `scratch-rehearsal-second/reversal.sql` | 220650 | `7bd7f0c40d58910d5fb599cba57e913ae62ebd311c57b8213b9df1697c7b3549` |
| `2026-09-17-kalyani-attribution-repair` | `scratch-rehearsal/before-image.json` | 232501 | `ab7aabd91943af4596b994a8854d8501a89fa93929f18a525888f163181de612` |
| `2026-09-17-kalyani-attribution-repair` | `scratch-rehearsal/reversal.sql` | 220619 | `abfad275eba08fe6d8b4a3beedcb945e3ad19c002ad4b89d1487ab5ab4eeb9dc` |
| `2026-09-17-kalyani-attribution-repair` | `targeted-bundle-v2/before-image.json` | 668838 | `de4b97ca191f8e816d8ab430c7c1673d50e41e6fdfb063856941ca3ca8e2b4af` |
| `2026-09-17-kalyani-attribution-repair` | `targeted-bundle-v2/reversal.sql` | 220650 | `fa327e383127d49ac9a68ddd627229dbb37e8bc388c16288f2a09eff0276369d` |
| `2026-09-17-kalyani-attribution-repair` | `targeted-bundle-v3/before-image.json` | 668928 | `2a184e5293ccb6d774b9a401d9f68c49a4969916ef1206382dc11629ef5708a4` |
| `2026-09-17-kalyani-attribution-repair` | `targeted-bundle-v3/reversal.sql` | 220650 | `4be17e98cbe474967290e04d54e6ce442e8a082a1506bfabbaa22a3007813200` |
| `2026-09-17-kalyani-attribution-repair` | `targeted-bundle-v4/before-image.json` | 672191 | `4ab44d7de483458c34bddaae0a688bd83a1ab065a26a93ec54145df4eea589bc` |
| `2026-09-17-kalyani-attribution-repair` | `targeted-bundle-v4/reversal.sql` | 220650 | `60d56b6e3fdd5feea1bbba3a123a3299324e29ff1ea971a31a7e9a5acc2cfbf6` |
| `2026-09-18-kalyani-attribution-repair-final` | `finance-history-followup/boundary-rehearsal-finance/before-image.json` | 1819 | `288cc804a1c63cba9078b716c0caa0e74de2ca5a7bb2b904a02dcead923a13cf` |
| `2026-09-18-kalyani-attribution-repair-final` | `finance-history-followup/device-boundary-production-final/before-image.json` | 1931 | `dc59aa65a02758c56f112788ca3eef1a8ae62344e183283240ef099d26d88844` |
| `2026-09-18-kalyani-attribution-repair-final` | `finance-history-followup/device-boundary-rehearsal/before-image.json` | 1931 | `82ee7333df954c3d6f9b58fc49b3c346aa0e3cd237594b88897c2db01a7b0daa` |
| `2026-09-18-kalyani-attribution-repair-final` | `finance-history-followup/production-final/before-image.json` | 1819 | `81c8f2e075dfbbc3bd3eef8f2684dbfa698b1ffe9b56c55d3d32fde038b5c515` |
| `2026-09-18-kalyani-attribution-repair-final` | `finance-history-followup/rehearsal/before-image.json` | 1819 | `e09c19f2d61d8a05bc439b7589e7a72f83c016ca77ed619dc3b2168c73b80797` |
| `2026-09-18-kalyani-attribution-repair-final` | `production-targeted-final-v3/before-image.json` | 766801 | `69108a1995fc35bc934bf661e57c3f4147beee63403789eabbca0771d56c7e07` |
| `2026-09-18-kalyani-attribution-repair-final` | `production-targeted-final-v3/reversal.sql` | 313886 | `be02134bf0930d762c6c82c8b8fd4e2c6112953500e35c142f78dc1ada389d57` |
| `2026-09-18-kalyani-attribution-repair-final` | `rehearsal-before-image-v3/before-image.json` | 766801 | `c4d2f8e6dee710d0406b2d91415b6117417e4aed4b8a3200888126e6ae3ac38f` |
| `2026-09-18-kalyani-attribution-repair-final` | `rehearsal-before-image-v3/reversal.sql` | 308957 | `e1de999c9a198f0ace965bded86981a4b14ad4e45f1f2ee6a58dbb109000c3a1` |
| `2026-09-18-kalyani-attribution-repair-final` | `rehearsal-insert-shift-v3/before-image.json` | 766801 | `ab8bc29d95343f84358f3e51fe6fc668c356986f1eb6232ea18179760e0e1709` |
| `2026-09-18-kalyani-attribution-repair-final` | `rehearsal-insert-shift-v3/reversal.sql` | 313886 | `ad3d70ad861052d73bfc3a0604b2a3c2f8268187903bce500483fb0f635bb356` |
| `2026-09-18-kalyani-attribution-repair-final` | `rehearsal-reviewed-v3/before-image.json` | 766801 | `ba3f289719bb076670bffac702395efd36e0d8835aa6360b8976b94222203e91` |
| `2026-09-18-kalyani-attribution-repair-final` | `rehearsal-reviewed-v3/reversal.sql` | 313886 | `d2e367f9dbf23b7605a857f60f7871dbcdf51bb4711feaf65614139e4092cb4b` |

25 files totalling 8,794,894 bytes were retired. No targeted row-level
production data from this incident remains on disk.

Consequence, recorded deliberately: both operator `verify` modes take a
`--before-image` that no longer exists. They were already unable to pass
for the schema and interval-count reasons in `next-day.md`; after this
retirement they cannot be invoked at all. The canonical read-only proofs
in `next-day.md` are the durable record.
