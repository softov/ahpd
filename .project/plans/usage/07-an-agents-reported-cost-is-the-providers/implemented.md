---
title: An agent's reported cost is kept as the provider's, and a record says nothing it was not told - implemented
date: 2026-10-08
refs:
  - "[code://packages/sdk/src/meter.ts](../../../../packages/sdk/src/meter.ts)"
  - "[code://packages/agent-claude/src/session/parts.ts](../../../../packages/agent-claude/src/session/parts.ts)"
  - "[code://packages/agent-pi/src/mapping.ts](../../../../packages/agent-pi/src/mapping.ts)"
---

A model record written for an agent's turn now keeps the harness's cost as both the cost it charges and the provider's cost, split into what was sent and what was received where the harness priced them apart, and it says nothing the harness did not say: a harness that spent nothing gets no cost rather than a cost of 0, a cost part that is not a count is left out, and a pi total is split the way pi split it.

## What was built

- [`code://packages/sdk/src/meter.ts`](../../../../packages/sdk/src/meter.ts) - `costOf` reads `input` and `output` from a harness's `_meta.cost` beside the amount, leaving out a part that is absent or is not a count. `write` sets `providerCost` to the same value as `cost`, and drops both when the amount is 0 and the report counted no token (`usedAny`). `addition` differences a cost's `input` and `output` per report as it already differenced the amount, so a per-report meter writes each round's own split.
- [`code://packages/agent-claude/src/session/parts.ts`](../../../../packages/agent-claude/src/session/parts.ts) - `costOf` reads a figure that did not go up as no spend, sends no cost when no model spent, and moves the `costUSD` baseline only for a model the result spent on. `newConversation` clears that baseline, and [`code://packages/agent-claude/src/session/query.ts`](../../../../packages/agent-claude/src/session/query.ts) calls it on the CLI's `conversation_reset`, so the turns after a `/clear`, a plan-mode exit or a fresh session are billed from zero rather than read as a step back below the old figure.
- [`code://packages/agent-pi/src/mapping.ts`](../../../../packages/agent-pi/src/mapping.ts) - `addUsage` sums pi's four priced parts over the calls: `input`, `cacheRead` and `cacheWrite` into the sent side, `output` into the received side, beside the total. A part no call sent stays absent.

## Verified

- `packages/sdk/test/usage-meter.test.ts`, 18 cases. Four are new: both costs carry the harness's figure and both parts; `input: "a half"` is left out; a cost of 0 with every count 0 gives neither cost; a cost of 0 on a turn that counted tokens is kept as 0. Reverting the two rules in `meter.ts` failed exactly the 3 new cases that assert them, and nothing else.
- `packages/agent-claude/test/agent-claude-usage.test.ts`, 10 cases. Two are new from task 02: a second `result` with the `modelUsage` the first left behind sends no cost, and a `result` the CLI came back with zeroed sends none either and leaves the `costUSD` baseline where it was, so the `result` that carries the running total back bills only what grew. Reverting `costOf` to its earlier rule failed exactly those 2 cases and no others. One is new from task 05: a `result` at $1.00, a zeroed `result` behind it that still sends no cost, then a `conversation_reset` and a `result` at $0.20 that sends $0.20, below the one-dollar baseline that only the reset takes back to zero. It failed before the change and the other nine held.
- `packages/agent-pi/test/agent-pi-usage.test.ts`, 6 cases. Two are new: two calls priced at `{input: 1, cacheRead: 0.5, output: 2}` send `input: 3`, `output: 4` and `amount: 7`; a call priced as a bare total sends the amount with no split. The split case failed before the change and the other five held.
- The whole suite: 251 files and 4384 tests. `pnpm build`, `pnpm typecheck`, `pnpm boundary` and `node tools/schema.mjs` pass. The test run rewrote `packages/sdk/test/fixtures/wire.jsonl` with this box's provider endpoint, which was restored; no frame format changed.

## Departures from the plan

- Task 01's Files name `costOf` and where the record is built. The cost's `input` and `output` are also differenced in `addition`, which the plan did not name: a per-report meter differences a harness's running total, and without the same treatment for its split every round would carry the whole split so far.
- Task 03's Files name the two cases. The test helper also had to change: it built a cost of four zeroed parts beside a positive total, which pi cannot send, since `models.js` computes `total` as the sum of the parts. It now builds pi's shape - the parts, and their sum as the total - and a bare number is still a call that reported a total and no split, so the four cases already in the file are unchanged.
- Task 02's step 3 asks whether `paid` is reset when a new `query()` starts while `modelUsage` carries on, or the reverse. Neither: the baseline must not move backwards at all. The 2026-10-02 costs of $0.68 and $1.36 are a zeroed `result` dragging the baseline to 0 and the `result` behind it billing the conversation's total again, and a machine that restarts a `query()` continues from the total its transcript saved, so resetting on a rebuild would bill the same spend twice.

## Left for later

- Task 04, a turn's tokens being what the provider counted, is not built. Its step 1 is a capture of a live `claude-openrouter` turn, which this box cannot take: it has no network egress, the repo holds no capture of one, and the recorded evidence is under `~/.config/ahpd/usage/`, which is outside the paths this session may read. Softov runs the capture.
- Task 05's reset is built and not yet reviewed or merged. It is the last of the plan but task 04, and the `/clear` gap the tasks 01-03 review found is closed: `conversation_reset` clears `paid`, so the turns after it are billed what they spent.
