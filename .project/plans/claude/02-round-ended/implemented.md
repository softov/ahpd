---
title: A response round that ends empty is announced, or the gap is recorded - implemented
date: 2026-09-20
refs:
  - code://.project/research/response-round-ended-signal.md
  - code://.project/plans/claude/02-round-ended/task-01-emit-round-ended.md
  - code://.project/plans/claude/02-round-ended/deferred.md
  - npm://@anthropic-ai/claude-agent-sdk@0.3.278
---

The plan ran its opening investigation and found that the Claude Agent SDK exposes no event for a model response round that ended with neither text nor tool calls, so the conditional task is dropped rather than built and the client gap is written down.

## What was built

- `code://.project/research/response-round-ended-signal.md` - the Answer: no member of the `SDKMessage` union marks an empty round, `message_stop` is a content-blind end of every API message, and the reference emits `responseRoundEnded` only from a Copilot `final_answer` phase.
- `code://.project/plans/claude/02-round-ended/deferred.md` - the client gap: an open reasoning section does not settle until the next part or the turn's `result` arrives.
- No code: `code://packages/agent-claude/src/session.ts` is untouched, because the plan's step 2 condition was met.

## Verified

- `pnpm test` green: 36 files, 641 tests.
- `pnpm typecheck` and `pnpm boundary` green.
- The live probe on the installed CLI (`claude -p "Reply with exactly: ok" --output-format stream-json --include-partial-messages --verbose`) showed the frame order `message_start`, content blocks, `assistant`, `content_block_stop`, `message_delta`, `message_stop`, `result`, with `message_start` carrying `"content":[]`.
- `grep -rn "responseRoundEnded" packages/ test/` returns nothing, which is the state the plan intends for a dropped task.

## Departures from the plan

- The research Method's second step named a daemon capture with `ahpd --wire <file>` on a prompt that produces an empty round; the probe captured the CLI's frame vocabulary directly instead of forcing an empty round, because the type surface decides the question and an empty round cannot be produced on demand.
- Steps 3 to 6 were not taken: step 2 stops the task, so the branch, its id, its guard and its test do not exist.

## Left for later

- The empty response round announcement - see [deferred.md](deferred.md).
