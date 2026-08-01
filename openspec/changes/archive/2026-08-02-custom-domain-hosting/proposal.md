# Proposal: custom-domain-hosting

## Why

The production PWA is served from the GitHub Pages project URL
`https://abdatta.github.io/shawarmania-ops/`. Shawarmania now owns
`shawarmania.in`, and the operations app needs a stable business-owned origin at
`https://ops.shawarmania.in/` without disturbing the landing page already served
from the apex domain.

The move also changes the deployment base from `/shawarmania-ops/` to `/`.
Because the router, manifest, service worker, asset URLs, and deep-link fallback
all depend on that base, the hosting cutover must deploy a root build rather than
only adding DNS.

## What changes

- Build the GitHub Pages production artifact with `BASE_PATH=/`.
- Ship `public/CNAME` with the canonical hostname.
- Point Hostinger's `ops` DNS record at GitHub Pages and save the identical
  custom domain in the app repository's Pages settings.
- Keep the local default and E2E path at `/shawarmania-ops/` so sub-path support
  remains a tested contract.
- Update the operating documentation and verify HTTPS, deep links, manifest
  scope, service-worker scope, and same-origin static assets on the live domain.

## Out of scope

- Changing the `shawarmania.in` landing page or its repository.
- Moving away from GitHub Pages.
- Changing authentication, tenancy, or application features.

## Risk

The old and new origins have separate browser storage and service-worker
registrations. Existing PWA installs therefore cannot migrate in place and must
be reinstalled from the new hostname. No application data is moved by this
change; Supabase remains the backend.
