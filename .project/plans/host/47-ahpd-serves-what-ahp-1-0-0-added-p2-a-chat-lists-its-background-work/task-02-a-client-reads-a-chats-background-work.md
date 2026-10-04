---
title: A client reads a chat's background work through the host
status: todo
depends: [task-01-the-claude-backend-lists-its-background-work.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/test/conformance.test.ts](../../../../packages/sdk/test/conformance.test.ts) - the Claude backend on a fake SDK through the host, replayed with the package's reducers"
  - "[code://packages/sdk/src/host.ts#L1127-L1134](../../../../packages/sdk/src/host.ts#L1127-L1134) - a worker chat's state, reduced from what the backend emitted"
  - "[code://packages/sdk/src/nested.ts#L305-L312](../../../../packages/sdk/src/nested.ts#L305-L312) - a nested host reduces what its inner host sends"
  - "[code://packages/sdk/src/nested.ts#L427](../../../../packages/sdk/src/nested.ts#L427) - and answers it as `chatState`"
  - "[code://packages/sdk/test/nested-proxy.test.ts](../../../../packages/sdk/test/nested-proxy.test.ts) - an inner host behind a nested one"
---

## Objective

A client subscribed to a Claude chat receives the background actions as task 01 emits them, a client subscribing later finds the same list in the snapshot, and a nested ahpd passes its inner host's background work on unchanged; nothing in the host changes for it.

## Files

- `UPDATE: packages/sdk/test/conformance.test.ts` - a case that feeds the background frames from task 01 and replays the chat channel.
- `UPDATE: packages/sdk/test/nested-proxy.test.ts` - a case where the inner host sends `chat/backgroundWorkSet`.

## Steps

1. In the conformance case, feed a `Bash` call with `run_in_background: true`, its `task_started` (`local_bash`) and a level naming it; subscribe a second client after that; then feed an empty level.
2. In the nested case, have the inner host dispatch `chat/backgroundWorkSet` with a shell entry on the inner chat, then `chat/backgroundWorkRemoved`.
3. If either fails because the host drops or reshapes the action, fix it in `host.ts` and say where in Resume.

## Validation

- `packages/sdk/test/conformance.test.ts`: replaying the chat channel from the first client's snapshot through `chatReducer` gives `backgroundWork` with the shell entry, then without it; and the second client's snapshot has the entry.
- `packages/sdk/test/nested-proxy.test.ts`: the outer client receives both actions on the outer chat URI, and the outer chat's snapshot between them lists the entry.
- A test asserts `isActionKnownToVersion({ type: 'chat/backgroundWorkSet', work }, '0.9.0')` is `true`, so a 0.9.0 connection is sent it.
- `pnpm test` passes.

## Resume
