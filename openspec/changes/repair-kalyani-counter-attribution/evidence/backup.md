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
