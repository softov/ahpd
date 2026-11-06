---
title: The host says each client action itself, and hands its backends what VS Code's host hands its agents - implemented
date: 2026-11-05
refs:
  - git://64d8ae96 - the merge of #240, MayCXC's branch replayed on main
  - "[code://packages/sdk/src/host/chatactions.ts](../../../../packages/sdk/src/host/chatactions.ts) - a client's action, said once the host's checks pass"
  - "[code://packages/sdk/src/host/spawn.ts](../../../../packages/sdk/src/host/spawn.ts) - the queue and the steering hand-off the host owns"
---

The host says a client's action itself once its checks pass. The backends get only the calls VS Code's host makes of its agents. The host drains the queue and hands steering on, and a stop closes the Claude CLI. MayCXC built it on his branch `host/20261103-2019-the-host-says-each-client-action-itself`, and #240 replayed main's commits on it.

## What was built

- [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts) - a client's action said with its origin, and the protocol's required fields filled.
- [`code://packages/sdk/src/host/spawn.ts`](../../../../packages/sdk/src/host/spawn.ts) - the queue drain and the steering hand-off.
- [`code://packages/sdk/src/host/localturns.ts`](../../../../packages/sdk/src/host/localturns.ts) - a `!` command's turn, found in a live chat.
- [`code://packages/agent-claude/src/session/query.ts`](../../../../packages/agent-claude/src/session/query.ts) - the Claude backend on the host's queue, and a result read as VS Code's mapper reads one.

## Verified

- CI on 2c555ffc passed every check, Windows included.
- `pnpm test`: 519 files and 8606 tests passed, none failed.

## Departures from the plan

- A Claude turn stopped at a limit completes, as [the decision](../../../decisions/a-claude-turn-stopped-at-a-limit-completes.md) says.
- The behaviour that changes from main is listed in the body of #240.

## Left for later

- Claude keeps a refused turn that a later turn replaced in its own history.
