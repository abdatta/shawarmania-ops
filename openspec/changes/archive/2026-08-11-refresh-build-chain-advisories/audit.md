# Build-chain advisory refresh evidence

This is the implementation evidence for `refresh-build-chain-advisories`.
The baseline was captured on Node 22.18.0 and npm 10.9.3 before changing the
lockfile.

## Baseline and reachability

`npm audit` reported three high-severity advisories covering four vulnerable
transitive resolutions. Every path is development/build reachable and none is a
browser runtime dependency.

| Package | Vulnerable | Patched | Dependency path |
| --- | --- | --- | --- |
| `brace-expansion` | 5.0.8 | 5.0.9 | ESLint → `minimatch` |
| `brace-expansion` | 2.1.2 | 2.1.4 | `vite-plugin-pwa` → `workbox-build` → `ejs` → `jake` → `filelist` |
| `fast-uri` | 3.1.4 | 3.1.5 | `vite-plugin-pwa` → `workbox-build` → `ajv` |
| `nanoid` | 3.3.16 | 3.3.18 | Vite → PostCSS |

The package-lock and audit-fix dry runs preserved the stale exact lock pins and
reported no changes, so they could not express the compatible lock-only refresh.
`npm explain` confirmed the existing parents already admitted the fixed releases
through `^5.0.5`, `^2.0.1`, `^3.0.1`, and `^3.3.16`. Registry tarball and
integrity metadata were verified before updating the four resolutions. The
complete lockfile diff contains only their versions, resolved URLs, and
integrities; it adds no platform package, direct dependency, or override.

## Installed tree and audit

An isolated copy of the committed package files completed `npm ci` with 550
packages in 22 seconds, and its `npm audit` result was zero vulnerabilities.
The repository's installed tree was restored and also audited clean. `npm ls`
resolved each affected path to the four patched versions above.

The isolated copy is the clean-install proof because an already-running local
Vite process held `lightningcss.win32-x64-msvc.node` open and caused Windows to
reject an in-place `npm ci` unlink with `EPERM`. That environmental file lock did
not affect resolution, audit, build, or tests. The pre-existing React Router
engine warning (`>=22.22` requested while the local runtime is 22.18) remained
nonfatal and was not widened into this change.

## Build and PWA evidence

- Focused build-tool and service-worker unit tests: 24 passed.
- Production build: passed; generated `dist/sw.js` and
  `dist/workbox-2fbc6a65.js` with 17 precache entries (1875.23 KiB).
- Offline-shell and update-adoption Playwright cases: 10 passed.
- Built-client inspection found no `brace-expansion`, `fast-uri`, or `nanoid`
  runtime inclusion.
