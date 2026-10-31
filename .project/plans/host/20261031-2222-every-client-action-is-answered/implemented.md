---
title: Every client action is answered, by its echo or a refusal - implemented
date: 2026-10-31
refs:
  - "[code://packages/sdk/src/host/chatactions.ts](../../../../packages/sdk/src/host/chatactions.ts) - a default chat archived, the background request, a client's tool call result"
  - "[code://packages/sdk/src/host/actions.ts](../../../../packages/sdk/src/host/actions.ts) - `automationRun/cancelRequested`"
  - "[code://packages/sdk/src/host.ts](../../../../packages/sdk/src/host.ts) - `owed` and `owedUnder`"
  - "[code://packages/sdk/src/sessions/nested.ts](../../../../packages/sdk/src/sessions/nested.ts) - `backgroundMcpServerStartup`"
---

Every action a client dispatches is answered to that client, by an envelope with its origin or a refusal, and the protocol case driver holds each case's actions to exactly one answer.

## What was built

- [`code://packages/sdk/test/ahp-test-cases.test.ts`](../../../../packages/sdk/test/ahp-test-cases.test.ts) - the driver numbers its dispatches and counts the envelopes carrying each one's origin; every case expects one per action.
- [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts) - `chat/isArchivedChanged` on a session's default chat archives the session as before and goes back to its sender alone on the chat; `session/mcpServerBackgroundRequested` is answered to its sender where no backend has the call or the backend did not take it; a client's `chat/toolCallComplete` is owed the completion the session reports for that call.
- [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts) - `owedUnder` names a tool call's completion by its call, and a turn's end lets go of its calls' completions; [`code://packages/sdk/src/host/context.ts`](../../../../packages/sdk/src/host/context.ts) - `owe` takes it.
- [`code://packages/sdk/src/sessions/nested.ts`](../../../../packages/sdk/src/sessions/nested.ts) - the background request is carried inside, so the answer there reaches the client outside.
- [`code://packages/sdk/src/host/actions.ts`](../../../../packages/sdk/src/host/actions.ts) - a run cancel taken is answered to its sender.
- [`code://packages/sdk/src/types/session.ts`](../../../../packages/sdk/src/types/session.ts) - the `backgroundMcpServerStartup` contract.
- [`code://docs/sdk/AHP.md`](../../../../docs/sdk/AHP.md) - the rows for `session/mcpServerBackgroundRequested`, `chat/toolCallComplete`, `chat/isArchivedChanged` and `automationRun/cancelRequested`, and the client tools' completion paragraph; [`code://docs/sdk/AUTOMATIONS.md`](../../../../docs/sdk/AUTOMATIONS.md) - the cancel row.

## Verified

- With the stricter driver on `08b1d57a`, protocol cases 272, 274, 275 and 276 go unanswered; all 647 pass after the change.
- On `08b1d57a` each new case fails for the reason it names: no envelope on the chat carries the archiving client's origin (host-snapshots), none carries the background request's (host-harness) or the run cancel's (automations), the completion goes out with no origin (host-tools), and no answer reaches the client outside a nested session (nested-proxy). All pass after the change.
- The 22 suites near these actions pass with 1381 tests; `pnpm run typecheck` and `pnpm run boundary` pass.
- The round's full run at two workers: `test:unit` passes 7347 with one 5 s timeout (plugin-load, whose file passes whole alone, 59 tests), and `test:processes` 694 with one (computer-state-seed, whose file passes whole alone, 8 tests). No test daemon was left running.

## Departures from the plan

- none.

## Left for later

- none.
