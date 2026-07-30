# Tasks: custom-domain-hosting

## 1. Prepare the root deployment

- [x] 1.1 Set the production Pages build to `BASE_PATH=/`.
- [x] 1.2 Add `public/CNAME` for `ops.shawarmania.in`.
- [x] 1.3 Update the operations and business-context documentation.
- [x] 1.4 Build with `BASE_PATH=/` and inspect the emitted HTML, manifest,
      service worker, fallback, and CNAME.

## 2. Verify and publish

- [x] 2.1 Run the repository's non-Docker CI gates.
- [ ] 2.2 Commit and push the change to `main`; confirm Pages deploys that
      commit successfully.

## 3. Cut over the hostname

- [ ] 3.1 Add the Hostinger `ops` CNAME without changing the apex or `www`
      landing-page records.
- [ ] 3.2 Save `ops.shawarmania.in` as the custom domain in GitHub Pages and
      enforce HTTPS.
- [ ] 3.3 Verify the live root, a direct nested route, PWA metadata,
      service-worker registration, asset requests, and the former URL redirect.
