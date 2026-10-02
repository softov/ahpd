---
title: claude counts every call
status: done
depends: []
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/session.ts#L1341-L1362](../../../../packages/agent-claude/src/session.ts#L1341-L1362) - where each API call's usage arrives"
  - "[code://packages/agent-claude/src/session.ts#L2668-L2675](../../../../packages/agent-claude/src/session.ts#L2668-L2675) - the end-of-turn emit"
---

## Objective

Each `message_delta` adds its call's usage to the turn and sends the running total; the `result` adds the turn's cost from `modelUsage`.

## Files

- `UPDATE: packages/agent-claude/src/session.ts:1215-1225` - `usageOf` also reads `cache_creation_input_tokens` into `_meta.cacheWriteTokens`.
- `UPDATE: packages/agent-claude/src/session.ts:1341-1362` - keep each call's `message_start` usage and add its `message_delta` usage to a per-turn sum, subagent calls included; emit `chat/usage` with the sum.
- `UPDATE: packages/agent-claude/src/session.ts:2668-2675` - the end emit sends the sum, plus `_meta.cost` from the change in `modelUsage[*].costUSD` since the last `result`, left out when any model's `costBasis` is `unknown`.

## Steps

1. Check in the SDK types how `message_start.message.usage` and `message_delta.usage` split input and output, so input is not counted twice.
2. Keep the per-turn sum beside the turn; reset it when a turn starts.
3. Keep the last `modelUsage` cost per query to take the difference at each `result`.

## Validation

- new `packages/agent-claude/test/agent-claude-usage.test.ts`: a turn with two API calls and a subagent call sends three growing `chat/usage` actions and an end total equal to their sum; cache writes and cost appear in `_meta`; `costBasis: 'unknown'` sends no cost.
- `pnpm -F @ahpd/agent-claude test`.

## Resume

Implemented 2026-10-01.

**What changed** - all in `packages/agent-claude/src/session.ts`:

- `usageOf` also reads `cache_creation_input_tokens` into `_meta.cacheWriteTokens`, so cache writes are no longer dropped. The `_meta` build follows cofold's `usageOf`.
- A per-turn sum `spent`, keyed by the SDK's own field names, added to by `count` and read by `sum`. `newTurn` empties it, called from `openTurn` for the main scope and from `beginTurn`, so a worker's own turn opening never clears the lead turn's.
- `streamed` counts at two points: `message_start` takes the call's input side (`INPUT_SIDE`), `message_delta` its final output (`OUTPUT_SIDE`) and then calls `sayUsage`, which sends the running total on the session's own chat and holds the turn to it. Subagent calls land in the same sum, so a worker's frames do not send a usage of their own.
- The `result` handler sends the sum plus `_meta.cost` from `costOf`, the change in `modelUsage[*].costUSD` since the last `result`, in the `{ amount, currency: 'USD' }` shape ACP's own `Cost` uses. `result.usage` is no longer read.

**What the split is** - `message_start.message.usage` and `message_delta.usage` are two halves of one measurement, and the delta repeats the input counts to the same numbers (checked in the captured fixture: both halves report `input_tokens: 2`, `cache_creation_input_tokens: 1265`, `cache_read_input_tokens: 21686`, while the start says `output_tokens: 1` where the call finished at 17). Reading both whole would bill every prompt twice and count the start's placeholder output. Hence `INPUT_SIDE` and `OUTPUT_SIDE`.

**What the tests cover** - new `test/agent-claude-usage.test.ts`, replaying the captured rounds from `agent-claude-round-ended` as one turn: a single call counted from the half that completes it and reported before `chat/turnComplete`; two lead calls plus one worker's call giving four reports, the last equal to their sum with the cost in `_meta`; the worker's chat receiving no usage of its own; the snapshot's turn holding the same number; the cost differenced across two results; and `costBasis: 'unknown'` sending no cost while still advancing the baseline. The expected totals are read off the fixtures rather than written out, so a fixture that changes cannot leave the test expecting a number nothing produces.

**What the plan did not know**

- `costBasis` is per model and overwritten per request, so a guess on one model suppresses the whole cost rather than that model's share of it: a partial sum of a price reads as the price. The baseline advances even for a suppressed cost, so the next `result` does not re-bill it.
- The turn's `usage` is now written on every `chat/usage`, not only at the end, so a client subscribing mid-turn reads the running total from the snapshot.
- A turn whose stream carried no partial messages now ends with no usage where it used to report `result.usage`. `includePartialMessages: true` is set unconditionally on the query (line 2069), so this needs a harness that streams nothing; a fallback to `result.usage` is not there. Restored turns are unaffected - they keep whatever their transcripts give, as the parent plan says.
- `pnpm -F @ahpd/agent-claude typecheck` does not exist; `tsc -p packages/agent-claude --noEmit` passes, but only after `pnpm -F @ahpd/sdk prepack` - the sdk resolves through its built `dist` and a fresh worktree has none.

**Review, 2026-10-01** - two fixes after reading the diff, each with a test that fails without it:
- A turn that streamed nothing falls back to `result.usage`, the main loop's own count.
- A model the CLI priced by guess no longer suppresses the cost of every later turn: `modelUsage` is cumulative, so only a model whose cost changed in this result can make the total a guess.

**Open questions** - none blocking.
