---
title: A resumed session keeps the worker chats it was restored with
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L5018-L5030](../../../../packages/sdk/src/host.ts#L5018-L5030) - a live session's `chats`, which lists only the workers opened in this process"
  - "[code://packages/sdk/src/host.ts#L5046-L5052](../../../../packages/sdk/src/host.ts#L5046-L5052) - a live chat's snapshot, with no links for restored workers"
  - "[code://packages/sdk/src/host.ts#L4747-L4756](../../../../packages/sdk/src/host.ts#L4747-L4756) - `subHistory`, which keeps an empty answer from a failed read"
  - "[code://packages/sdk/src/host.ts#L4825-L4842](../../../../packages/sdk/src/host.ts#L4825-L4842) - `history`, which keeps only an answer with turns"
---

## Objective

A session read back after a restart and then sent a turn still lists its restored worker chats, its lead chat still links them, and a failed read of its workers is tried again rather than remembered as none.

## Files

- `UPDATE: packages/sdk/src/host.ts:5018-5030` - once live, the restored workers drop out of `chats` with no `session/chatRemoved`.
- `UPDATE: packages/sdk/src/host.ts:5046-5052` - the live lead chat's calls lose their `subagent` content.
- `UPDATE: packages/sdk/src/host.ts:4747-4756` - `restoredSubagents` caches `[]` when `owner.subagents` throws.
- `UPDATE: test/agent-claude-subagent-restore.test.ts`.

## Steps

1. A live session's `chats` lists the workers `restoredSubagents` read for it, with `restoredSubagentSummary`, beside the ones opened live, each once.
2. A live lead chat's snapshot runs `linkedTurns` over its turns with those workers.
3. `restoredSubagents` keeps an answer only when the read succeeded, as `history` does.

## Validation

- `test/agent-claude-subagent-restore.test.ts`: after the restored session lists its two workers, send it a turn (the SDK mock gains a `query` that answers one turn, since it mocks only `listSessions` and `getSessionMessages` today); a subscribe to the session still lists both, and a subscribe to the lead chat returns `toolu_task` with its `subagent` content. Fails today.
- The same file: `owner.subagents` throws on its first call and answers on its second; the second subscribe lists the workers. Fails today.
- `pnpm typecheck` green.

## Resume
