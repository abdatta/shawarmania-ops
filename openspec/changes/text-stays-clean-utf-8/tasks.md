# Tasks: text-stays-clean-utf-8

- [x] 1. Reproduce: scan every tracked text file for a BOM and for UTF-8 read back as Windows-1252. Found the Team hint, two source comments, seven lines across two living specs, and BOMs only in dated archive evidence.
- [x] 2. Write `scripts/check-encoding.mjs` and run it on the unfixed tree: it exits 1 naming all thirteen lines, `src/features/accounts/accounts-surface.tsx:692` among them.
- [x] 3. Restore every broken sequence to its intended character (en dash in the hint, em dashes elsewhere), checked against the commit that introduced each. Mark the two lines that show the fault on purpose with `encoding-check: allow`.
- [x] 4. `scripts/check-encoding.test.mjs`: clean text passes; a mangled en dash, em dash, middle dot and accented letter each fail on their line; a BOM fails; an allowed line and a binary file pass. Both files plain ASCII.
- [x] 5. Wire `lint:encoding` into `npm run lint` and the prose-tier workflow, and say so in AGENTS.md (the Design rule and the Verification list).
- [x] 6. `npm run typecheck`, the accounts and Zomato tests, the check's own tests, `lint:encoding`, `format:check` on the touched files.
- [ ] 7. GATE: the hint reads *3–30*; `npm run lint:encoding` passes on the tree and failed on it before the fix; CI's lint and prose tiers both run it. The owner picks the deploy window; this commit is local until then.
