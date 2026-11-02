---
title: Every client action is answered, by its echo or a refusal - implemented
date: 2026-10-31
refs:
  - "[code://packages/sdk/src/host/chatactions.ts](../../../../packages/sdk/src/host/chatactions.ts) - a default chat archived, the background request, a client's tool call result"
  - "[code://packages/sdk/src/host/actions.ts](../../../../packages/sdk/src/host/actions.ts) - `automationRun/cancelRequested`"
  - "[code://packages/sdk/src/host.ts](../../../../packages/sdk/src/host.ts) - `owed` and `owedUnder`"
  - "[code://packages/sdk/src/sessions/nested.ts](../../../../packages/sdk/src/sessions/nested.ts) - `backgroundMcpServerStartup`"
---

Every action a client dispatches is answered to that client, by an envelope with its origin or a refusal.
The protocol case driver holds each case's actions to exactly one answer.

## What was built

- [`code://packages/sdk/test/ahp-test-cases.test.ts`](../../../../packages/sdk/test/ahp-test-cases.test.ts) - the driver numbers its dispatches and counts the envelopes carrying each one's origin; every case expects one per action.
- [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts) - three answers.
  - `chat/isArchivedChanged` on a session's default chat archives the session as before, and goes back to its sender alone on the chat.
  - `session/mcpServerBackgroundRequested` is answered to its sender where no backend has the call or the backend did not take it.
  - A client's `chat/toolCallComplete` is owed the completion the session reports for that call.
- [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts) - `owedUnder` names a tool call's completion by its call, and a turn's end lets go of its calls' completions; [`code://packages/sdk/src/host/context.ts`](../../../../packages/sdk/src/host/context.ts) - `owe` takes it.
- [`code://packages/sdk/src/sessions/nested.ts`](../../../../packages/sdk/src/sessions/nested.ts) - the background request is carried inside, so the answer there reaches the client outside.
- [`code://packages/sdk/src/host/actions.ts`](../../../../packages/sdk/src/host/actions.ts) - a run cancel taken is answered to its sender.
- [`code://packages/sdk/src/types/session.ts`](../../../../packages/sdk/src/types/session.ts) - the `backgroundMcpServerStartup` contract.
- [`code://docs/sdk/AHP.md`](../../../../docs/sdk/AHP.md) - the rows for `session/mcpServerBackgroundRequested`, `chat/toolCallComplete`, `chat/isArchivedChanged` and `automationRun/cancelRequested`, and the client tools' completion paragraph; [`code://docs/sdk/AUTOMATIONS.md`](../../../../docs/sdk/AUTOMATIONS.md) - the cancel row.

## Verified

- With the stricter driver on `08b1d57a`, protocol cases 272, 274, 275 and 276 go unanswered; all 647 pass after the change.
- On `08b1d57a` each new case fails for the reason it names. All pass after the change.
  - No envelope on the chat carries the archiving client's origin (host-snapshots).
  - None carries the background request's (host-harness) or the run cancel's (automations).
  - The completion goes out with no origin (host-tools).
  - No answer reaches the client outside a nested session (nested-proxy).
- The 22 suites near these actions pass with 1381 tests; `pnpm run typecheck` and `pnpm run boundary` pass.
- The round's full run at two workers: `test:unit` passes 7347 with one 5 s timeout, in plugin-load, whose file passes whole alone (59 tests).
- `test:processes` passes 694 with one 5 s timeout, in computer-state-seed, whose file passes whole alone (8 tests). No test daemon was left running.

## Departures from the plan

- none.

## After Softov's review of 2026-11-01

The review's bug: a refused `chat/toolCallComplete` wiped another dispatch's owed answer.
A client's second result for one call was owed under the first one's key and then refused, so the completion went out with no origin.

- [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts) - the result is owed its completion only once `completeToolCall` takes it, as the review asks.
- [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts) - `answeredBy` lets go of an owed answer only when it is the answered dispatch's own. A refusal under the first result's key otherwise still wipes the first result's answer.
- `owe` holds nothing for a dispatch the backend already said back.
- A turn's end lets go of its calls' completions in its own chat, since [host/20261101-1922](../20261101-1922-answers-and-command-turns-are-per-chat/plan.md) keys an owed answer by its chat.
- `packages/sdk/test/host-tools.test.ts`: the second result is refused, and the first is answered by the completion. The case fails before the change, with no answer for the first.
- It fails again with only one half of the change, `owe` before `completeToolCall` or `answeredBy` without the check.
- The review's note on the background request: `declined` finds the server where the protocol reducer's `updateMcpServerCustomization` does. That is at the top of the list, or in the `children` of an entry that is not a server.
- `packages/sdk/test/host-harness.test.ts` holds a blocking server inside a plugin to the same answer as one listed on its own. Before the change the other client heard nothing.

## Left for later

- The review's note that a worker chat's stop is never answered. The stop is said on the worker's channel, and the worker's own `chat/turnCancelled` answers it. When the backend stops the lead turn instead, the lead's answers it on another channel. Owing that answer needs the worker chat's running turn, which this branch does not hold.
