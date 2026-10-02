---
title: ACP sends the cost and tokens its agent reports - implemented
date: 2026-10-01
refs:
  - git://usage-p4-acp - the branch it was built on
  - "[code://packages/agent-acp/src/session.ts](../../../../packages/agent-acp/src/session.ts)"
---

An ACP turn now reports the cost its agent sent during the turn, as the change in the session's cumulative `usage_update.cost`, and the tokens from `PromptResponse.usage` when the agent sends them.

## What was built

- [`code://packages/agent-acp/src/mapping.ts`](../../../../packages/agent-acp/src/mapping.ts) - `usage_update` sends the turn's cost so far.
- [`code://packages/agent-acp/src/session.ts`](../../../../packages/agent-acp/src/session.ts) - the session's running cost, the turn's starting point, and the prompt response's counts as the last report.
- [`code://packages/agent-acp/src/types.ts`](../../../../packages/agent-acp/src/types.ts) - `AcpTurn.costAtStart`, `cost` and `prompted`.
- [`code://packages/agent-acp/test/agent-acp-usage.test.ts`](../../../../packages/agent-acp/test/agent-acp-usage.test.ts) - six cases against the fixture server.

## Verified

- Root `pnpm test`: 130 files, 1955 tests passed; `pnpm exec tsc --noEmit` and `pnpm boundary` clean; the usage file run five times without a failure.

## Departures from the plan

- `types.ts` changed too: the turn's cost state lives on `AcpTurn`, which `mapUpdate` reads.
- `thoughtTokens` goes out as `_meta.reasoningTokens`, cofold's spelling; `totalTokens` is dropped as a sum of counts already sent.
- Review fix: a cost reported before the prompt is the turn's starting point, not its spend.

## Left for later

- A rebuilt transcript reports no usage: a replay has no starting cost, so it could only report the session's whole.
- A resumed session whose server reports no cost before the prompt still charges its first turn the whole session.
