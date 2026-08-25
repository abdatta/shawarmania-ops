# 9.4 coverage audit (2026-08-24)

Every legacy Swiggy date compared against annexure facts allocated by
Kalyani's 04:00 business-day cutover (RID 1096540, cycle Aug01-08 final;
Aug16-22 still PENDING):

| Business date | Typed rev/comm paise | Candidate gross(NBV)/net | Verdict |
|---|---|---|---|
| 2026-08-06 | 89600 / 33152 | 89600 / 62445 | **matched** - gross delta 0 |
| 2026-08-07 | 58600 / 21682 | 88400 / 61603 | **explained** - hand entry missed one 29800-paise order |
| 2026-08-08 | 117200 / 43364 | 117200 / 80974 | **matched** - gross delta 0 |
| 2026-08-17 | 129200 / 47804 | cycle pending | **explained** - awaiting FINAL settlement |

Zero unexplained rows. Kanchrapara holds only zero-valued typed days and has
no Swiggy mapping, so it counts as neither missing trade nor zero. Typed
commissions were flat-rate guesses (~37 percent) and supersede to exact
measured reductions once settlement covers each date.

## Owner acceptance (2026-08-24)

The owner accepted this audit: data extracted from Swiggy overrides typed data wherever they disagree, because typed entry is error-prone. The 10.1 field-removal gate is therefore passed.
