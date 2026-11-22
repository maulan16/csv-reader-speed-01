# Fast CSV reader

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![make.fun · rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/maulan16/csv-reader-speed-01/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![make.fun · reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/maulan16/csv-reader-speed-01/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

An entry for make.fun's CSV reader speed competition: it reads each case's CSV text and answers exactly what
csv-reader 1.0.0 answers (header, rows and the broken-record errors), only faster.

## How it works

- `solve.js` exports `run(input)`, a char-code state machine that returns the same object csv-reader returns.
- `runBytes(input)` is the one `main.ts` uses: it reads the text as UTF-8 bytes once and writes the answer's JSON
  straight into a byte buffer (JSON escaping done inline), so no per-field strings or arrays are built. Header,
  first and broken records take a careful field-by-field path; ordinary records copy runs of bytes. A text with a
  lone surrogate falls back to the string path (`runJSON`).
- A short warm-up on a synthetic, fixed-seed CSV gives V8 type feedback for the rare branches before the real cases.
- `main.ts` reads `/input/cases.json` and writes `/output/answers.json`; no dependencies, no clock, no randomness,
  so two runs write the same bytes.

## Run

```
MAKEFUN_INPUT_DIR=practice/input MAKEFUN_OUTPUT_DIR=/tmp/out node main.ts
```

MIT licensed.
