# Tasks: outlet-scope-narrowing-keeps-the-set

- [x] 1. Pin the bug: a test that seeds a two-outlet selection, chooses one of
      those two on a single-outlet surface, and asserts both are still
      remembered with the chosen one leading. Proved failing first.
- [x] 2. Fix the narrowing at both places it happened — the initial read, which
      truncated the remembered selection to one, and `choose`, which wrote over
      it — so a pick inside the selection reorders and a pick outside replaces.
      Narrow what the surface *reads* instead, at `scope`.
- [x] 3. Gate: `npm run typecheck`, `npx vitest run src/features`, and
      `npm run format:check`.
