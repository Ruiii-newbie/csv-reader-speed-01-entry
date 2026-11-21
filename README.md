# Fast CSV reader

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/Ruiii-newbie/csv-reader-speed-01-entry/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/Ruiii-newbie/csv-reader-speed-01-entry/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A faster drop-in for make.fun's own csv-reader 1.0.0, built for the [Read broken CSV files faster bounty](https://make.fun/bounty/csv-reader-speed-01-run-20261121) ($100, top 10 paid).

`run(input)` in `solve.js` returns exactly what csv-reader 1.0.0 returns for the
same `{text, header}` — `{columns, rows, errors}` with its broken-row policy
(stray CRs, quote junk, unterminated quotes, short/long rows, blank lines) —
only faster. The reference walks the text one character at a time; this reader
finds each field's end with `indexOf` and slices fields out in one go, and only
the rare broken paths do per-character work over the one short field involved.
`main.ts` is the house driver: it reads every case from `/input/cases.json`,
answers each with `run`, and writes `/output/answers.json`.

## Run it

```sh
node main.ts
```

Node 22 or later, no dependencies, no install step.
