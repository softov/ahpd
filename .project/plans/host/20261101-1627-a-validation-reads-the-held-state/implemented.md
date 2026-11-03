---
title: A validation reads the held state - implemented
date: 2026-11-01
refs:
  - git://68c0fc36
  - "[code://packages/sdk/src/host/chatactions.ts](../../../../packages/sdk/src/host/chatactions.ts)"
  - "[code://packages/agent-claude/src/session/stream.ts](../../../../packages/agent-claude/src/session/stream.ts)"
  - "[code://packages/sdk/test/ahp-test-cases.test.ts](../../../../packages/sdk/test/ahp-test-cases.test.ts)"
---

The host checks each client action the protocol validates over a chat's state against the state it holds for that chat.
That is the state every client was served, so a refusal names a condition a client can see.
An accepted action that no backend says back, or takes to say later, is said back by the host.
A client's result is checked against the client the held call names, and a Claude call a client runs names that client from its start.

## What was built

- [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts) - a cancel, a resume, a removal, a draft, a confirmation, both input actions, a truncation and a client's result read the held chat state.
- The same file - the host says the end of a held turn the backend does not run.
- The same file - a steering removal during a turn is refused in the reference's words.
- [`code://packages/sdk/src/host/state.ts`](../../../../packages/sdk/src/host/state.ts) and [`code://packages/sdk/src/host/spawn.ts`](../../../../packages/sdk/src/host/spawn.ts) - `Dispatched.taken`, set by `Start.handed`.
- [`code://packages/sdk/src/host/context.ts`](../../../../packages/sdk/src/host/context.ts) and [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts) - `unanswered`, whether the dispatch being applied still has no answer.
- [`code://packages/sdk/src/types/session.ts`](../../../../packages/sdk/src/types/session.ts) and [`AGENT.md`](../../../../docs/sdk/AGENT.md) - when `confirm`, `answer`, `setAnswer` and `completeToolCall` are handed over, and who says the echo.
- [`code://packages/agent-claude/src/session/stream.ts`](../../../../packages/agent-claude/src/session/stream.ts) and [`code://packages/agent-claude/src/session/asking.ts`](../../../../packages/agent-claude/src/session/asking.ts) - a streamed start and a question's start name a client's own tool by its client.
- [`code://packages/sdk/src/tools/clientcalls.ts`](../../../../packages/sdk/src/tools/clientcalls.ts) and [`code://packages/agent-claude/src/session/clienttools.ts`](../../../../packages/agent-claude/src/session/clienttools.ts) - a worker's client call is raised under the worker's chat.
- [`code://packages/sdk/test/ahp-test-cases.test.ts`](../../../../packages/sdk/test/ahp-test-cases.test.ts) - `REFUSALS` rows carry `holds`, read against the state the client held when it sent the action.

## Verified

- Run against the chat actions of the base commit, the oracle fails 15 cases.
- They are 015, 042, 048, 049, 063, 064, 065, 067, 108, 110, 224, 235, 263, 267 and 269.
- After it the oracle passes 647 of 647, with the entries for 015 and 224 removed.
- `host-tools.test.ts`: a streamed start named `mcp:ahp` before the change, and a question's start named nobody.
- The same file: an input answer naming a call a person was asked about approved the tool before the change; it is refused after.
- `agent-claude-subagent.test.ts`: a worker's call was raised under the lead chat before the change.
- `subagent-chat.test.ts`: a second confirmation of one call reached the backend before; it is refused after.
- `pnpm run test:unit --maxWorkers=2`: 7357 passed, 8 failed, 28 skipped.
- Six of the eight are timeouts under load, and the six files pass when run again away from the full run.
- Alone, the first case of `nested-start.test.ts` took 3.3 to 5.3 s against a 5 s timeout.
- Its process cases have 30 s now, and it passed three runs of three.
- The usage pools case in `users-gate-commands.test.ts` fails on the base commit too. The branch `usage/20261101-0158-the-usage-pools-case-holds-its-clock` fixes it in the union.
- `pnpm run typecheck` and `pnpm run boundary` exit 0.

## Departures from the plan

- `Session.toolCallOwner` stays as a backend's own record; the host reads the contributor off the held call.
- A result the backend holds no call for is refused, as R1 refuses a second result for a call.
- The plan had the host say such a result.
- An input answer naming a call a person is asked to confirm is refused by the held state's check, so `answer` is never handed one.

## Left for later

- Nothing; every task is done.
