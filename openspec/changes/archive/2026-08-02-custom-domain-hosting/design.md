# Design: custom-domain-hosting

## D1 — The deployment base changes; the source routing contract does not

The deploy workflow sets `BASE_PATH=/`. Vite already threads that one value
through `base`, React Router's `basename`, the PWA manifest scope, Workbox's
navigation fallback, and all rewritten asset URLs. The source default stays
`/shawarmania-ops/` so a routine local build and the E2E suite continue testing
the harder sub-path case.

## D2 — DNS and repository ownership name the same host

Hostinger owns the DNS zone and publishes `ops` as a CNAME to
`abdatta.github.io`. GitHub Pages is configured with
`ops.shawarmania.in`, and the deployed artifact carries the same value in
`CNAME`. This does not touch the apex or `www` records used by the landing page.

## D3 — The PWA moves origins cleanly

The new origin receives a root-scoped manifest and service worker. The old
worker cannot overlap because service-worker authority never crosses origins.
Existing installations remain bound to the old origin and are reinstalled
rather than attempting to reuse or clear their storage.

## D4 — Verification is against production, not only DNS

The cutover is complete only when:

- `https://ops.shawarmania.in/` serves the deployed build over HTTPS;
- a direct nested route boots the SPA fallback;
- the manifest has root `start_url` and `scope`, and root-relative icon URLs;
- the service worker is registered beneath the new origin;
- application assets load from the new origin without 404s; and
- the former GitHub Pages project URL redirects to the custom domain.
