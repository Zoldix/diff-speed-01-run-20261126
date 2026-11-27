# diff-speed-01-run-20261126 — Diff two texts faster

[![make.fun · diff-speed-01-run-20261126](https://make.fun/badge/diff-speed-01-run-20261126.svg)](https://make.fun/bounty/diff-speed-01-run-20261126?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)
[![rank](https://make.fun/badge/diff-speed-01-run-20261126/Zoldix/diff-speed-01-run-20261126/rank.svg)](https://make.fun/bounty/diff-speed-01-run-20261126/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)
[![reward](https://make.fun/badge/diff-speed-01-run-20261126/Zoldix/diff-speed-01-run-20261126/reward.svg)](https://make.fun/bounty/diff-speed-01-run-20261126?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)

Entry for the make.fun competition
[diff-speed-01-run-20261126](https://make.fun/bounty/diff-speed-01-run-20261126):
`main.ts` (the standard driver) reads every case from `/input/cases.json`,
answers each with `run` from `solve.js`, and writes `/output/answers.json`.
`solve.js` is a dependency-free ES module whose `run({ old, new })` returns
exactly the patch makefun-diff 1.0.0 returns — the same lines, the same Myers
edit script with the deletion winning a tie, the same hunks — computed faster.

## Method

Exactness is a binary gate, so the search reproduces the reference's rule
step for step; only the machinery changes.

1. Lines are cut after every `\n` and interned once to integer ids through a
   `Map`, so line equality inside the search is an integer compare.
2. The common prefix of lines is kept, then the common suffix of the rest —
   the same trims the reference makes.
3. Myers's greedy search keeps, per round and diagonal, only the furthest
   old-line index reached, in `Int32Array`s — no path objects, no token
   slices.
4. The winning path's history is rebuilt by walking those snapshots back,
   recomputing each step's predecessor with the reference's own candidate
   rule (the candidate further into the old text; the deletion on a tie)
   from the previous round's stored values — exactly the predecessor the
   forward pass chose.
5. The patch (header, `@ os ol ns nl` hunks with 3 lines of context, runs at
   most 6 kept lines apart sharing a hunk, deletions before insertions,
   `%` after a line ending its text without a newline) is assembled in one
   pass and joined once.

No state is kept between calls: every answer is a pure function of its
input, so two executions write the same bytes.
