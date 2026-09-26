---
title: Any task_started marks a worker background, but a foreground spawn still ends on its tool_result
status: accepted
date: 2026-09-26
refs:
  - "[code://packages/agent-claude/src/session.ts#L2461-L2475](../../packages/agent-claude/src/session.ts#L2461-L2475) - `task_started` and `task_notification`, which today read `is_backgrounded`"
  - "[code://packages/agent-claude/src/session.ts#L1661-L1669](../../packages/agent-claude/src/session.ts#L1661-L1669) - the spawning call's result, which ends a worker unless it is background"
  - "[code://test/fixtures/claude-subagent.jsonl](../../test/fixtures/claude-subagent.jsonl) - a foreground worker: `run_in_background: false` on line 2, `task_started` on line 3, `task_notification` on line 12, the `tool_result` on line 13"
  - https://github.com/microsoft/vscode/blob/832cf23c588/src/vs/platform/agentHost/node/claude/claudeSubagentSignals.ts - `mapSubagentSystemMessage`, which marks any call named by `task_started` background
---

## Context

The CLI sends `task_started` for every worker, foreground or background, with `is_backgrounded` saying which.
The reference marks any call named by `task_started` background and ends it on its terminal `task_notification`, so under its rule no worker ends on its call's `tool_result`.
A foreground worker whose notification is missing or not terminal, for example one that fails or is interrupted, would then keep its turn open, where its `tool_result` would have closed it.

## Decision

Any `task_started` marks its call background, as the reference does; a call whose input says `run_in_background: false` still ends its worker's turn on its `tool_result`, and a background worker ends on its terminal `task_notification`, whichever arrives first ending it once.
Source: Softov, 2026-09-26, asked "Which rule decides background?": "VS Code's rule, but a call with run_in_background: false still ends on its tool_result".

## Consequences

The code no longer reads `is_backgrounded`.
The spawning call's `run_in_background` input is recorded with the call in `spawning`.

## Options

- **The reference's rule as written.** Every worker ends on its notification, and a foreground worker with no terminal notification never ends.
- **`is_backgrounded`.** Matches the CLI's own flag, and departs from the reference.
