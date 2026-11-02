## 1. Fix

- [x] 1.1 `outlets-overview.test.tsx`: Needs attention is visible while a delivery issue waits, and is not visible, with no heading and no *Nothing waiting*, once nothing waits (fails today: the card stays visible)
- [x] 1.2 `needs-attention.tsx`: rows report their counts; the section is `hidden` once every row has read zero
- [x] 1.3 Spec delta for `attention-badges`; `docs/SCREENS.md` says the section is left out when empty

## 2. Gate

- [x] 2.1 The Overview test fails with 1.2 reverted (with only the test id added, so it fails on visibility) and passes with it; typecheck, lint, format and the touched test file pass
- [x] 2.2 Pushed to `stage`, Staging green
  *(`9cab8ca7`, Staging 41400563737 green and serving it on stage-ops. Promoted
  to production with `c83ec673` on 2 November (Deploy 41404706038). The owner
  checked it on staging and in production the same day and called it good.)*
