---
title: The queue drains as VS Code drains it - implemented
date: 2026-11-03
refs:
  - git://631c1419 - task 01, `ff7f255e` applied to upstream main
  - git://edde348e - task 02
  - "[code://packages/sdk/src/sessions/catalog.ts](../../../../packages/sdk/src/sessions/catalog.ts)"
---

A chat's queue starts after a turn that completed or ran a `!` command, in every backend.
A stopped or failed turn starts nothing behind it.
A client's message queued, taken back or reordered while nothing runs starts the head.
Claude, pi and cofold start nothing while their latest turn is a failure a client can resume.

## What was built

- [`code://packages/sdk/src/sessions/catalog.ts`](../../../../packages/sdk/src/sessions/catalog.ts) - `holdsTheQueue`, the one rule for a resumable failure, exported from the SDK.
- [`code://packages/agent-claude/src/session/query.ts`](../../../../packages/agent-claude/src/session/query.ts) - a result starts the queue only for a turn that completed, or for a start a client asked for while the CLI owed it.
- [`code://packages/agent-claude/src/session/turns.ts`](../../../../packages/agent-claude/src/session/turns.ts) - no start after a refused turn or a failed resume; `unqueue`, `reorder` and a queued command start the head; `startNext` holds.
- [`code://packages/agent-claude/src/session/logins.ts`](../../../../packages/agent-claude/src/session/logins.ts) - no start after a failed move to another login.
- [`code://packages/agent-pi/src/session.ts`](../../../../packages/agent-pi/src/session.ts) - `finish` starts the queue only after a success; `unqueue` and `reorder` start the head; `startNext` holds.
- [`code://packages/agent-acp/src/session/turn.ts`](../../../../packages/agent-acp/src/session/turn.ts), `queue.ts`, and cofold's `runs.ts` and `turns.ts` - the same turn end and client changes.
- [`code://packages/bot/src/chat.ts`](../../../../packages/bot/src/chat.ts) - `finish` starts the queue after a completed turn alone, and `unqueue` and `reorder` start the head.
- `examples/echo/agent.ts` and `examples/notes/agent.ts` - `unqueue` and `reorder` start the head.
- [`code://docs/sdk/AHP.md`](../../../../docs/sdk/AHP.md) and [`code://docs/sdk/CHATS.md`](../../../../docs/sdk/CHATS.md) - when the queue starts.

## Verified

- `631c1419` and `ff7f255e` remove and add the same 143 lines; on `a8eff676`'s sources its three cases fail, the queued message started at the stop.
- On `a8eff676`'s sources the fifteen cases of task 02 fail, and with `edde348e` they pass.
- Each touched test file passes alone at one worker, as do 26 other files that touch the queue or a failed turn.
- `pnpm run typecheck` and `pnpm run boundary` report no errors.

## Departures from the plan

- Task 02 - the hold sits in the three backends that write a resumable failure, and not in ACP, the bot or the examples.
- Task 02 - a queued `!command` set while nothing runs starts the head too, and pi starts the queue after a `!command` that throws.
- Task 02 - cofold's case for a message queued during a failed resume now holds it until a resume completes.

## Left for later

- None.
