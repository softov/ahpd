---
title: A Claude turn the CLI stopped at a limit completes, and a steer answered after it stays in that turn
status: accepted
date: 2026-11-05
refs:
  - "[code://packages/agent-claude/src/session/query.ts#L1002](../../packages/agent-claude/src/session/query.ts#L1002) - the result subtypes that fail a turn"
  - "[code://packages/agent-claude/src/session/query.ts#L1051](../../packages/agent-claude/src/session/query.ts#L1051) - a turn stays open while the CLI owes a prompt handed in it"
  - https://github.com/microsoft/vscode/blob/d1a91b3af8869c37d4757aa959f0859b59c33265/src/vs/platform/agentHost/node/claude/claudeMapSessionEvents.ts#L568-L576 - `getResultErrorText`, which gives an error only for `success` with `is_error` and for `error_during_execution`
  - https://github.com/microsoft/vscode/blob/d1a91b3af8869c37d4757aa959f0859b59c33265/src/vs/platform/agentHost/node/claude/claudeSdkPipeline.ts#L723-L739 - `settleHead` settles a prompt on each result, and the turn completes only when the queue is empty
---

## Context

The Claude CLI ends a run with a `result` message. Its `subtype` is `success`, `error_during_execution`, or a limit the CLI stopped at: `error_max_turns`, `error_max_budget_usd` or `error_max_structured_output_retries`. A limit result can carry `is_error: true`.

A steering message sent in the last round of a turn is answered after the limit result. The capture `claude-failed-steer.jsonl` holds this: an `error_max_turns` result for the turn, then a `success` result for the steer.

Main ended the turn in `chat/error` at the limit and ran the steer's answer as a turn of its own. The 2019 branch ended the turn in `chat/error` and dropped the answer. A later reader can take the limit for a failure, because its subtype starts with `error_` and it says `is_error`.

## Decision

A result fails its turn only when its `subtype` is `success` with `is_error: true`, or `error_during_execution`, as VS Code's `getResultErrorText` reads one. Every other subtype completes the turn with no error part.

A turn stays open while the CLI owes an answer to a prompt handed in it. A steer answered after a limit result is part of the turn it went into. The turn completes at the last result, as VS Code's `settleHead` completes a turn only when its queue is empty.

Source: Softov, 2026-11-05: "follow VS Code. error_max_turns is not an error: the steer's answer stays inside the same turn, and the turn completes at the last result." He chose VS Code's whole rule over `error_max_turns` alone, after a check of VS Code main at `d1a91b3a`.

## Consequences

A turn stopped by the turn, budget or retry limit reads as complete, live and read back from the transcript. The session's status is not `Error` after one.

A client is not told that a limit stopped the turn. VS Code tells it nothing either.

A steer in a turn that fails in execution still opens no turn, and its answer goes nowhere.

## Options

- **Main's behaviour.** The limit ends the turn in an error, and the steer's answer is a turn of its own. It shows the limit, but it is a turn the person did not start, and VS Code opens none.
- **The 2019 branch's behaviour.** The limit ends the turn in an error, and the steer's answer is dropped. The person's message gets an answer that no client shows.
- **Only `error_max_turns` completes.** The budget and retry limits stay errors. It differs from VS Code for those two subtypes, for no reason the code gives.
