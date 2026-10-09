---
title: A client reads a chat's background work through the host
status: done
depends: [task-01-the-claude-backend-lists-its-background-work.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/test/conformance.test.ts](../../../../packages/sdk/test/conformance.test.ts) - the Claude backend on a fake SDK through the host, replayed with the package's reducers"
  - "[code://packages/sdk/src/host/spawn.ts#L79-L85](../../../../packages/sdk/src/host/spawn.ts#L79-L85) - a worker chat's state, reduced from what the backend emitted"
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

## Outcome

`packages/sdk/test/conformance.test.ts` gained two cases. One drives the fake SDK with a `Bash` call, its `task_started` and a level naming it. It reads the shell entry off the subscribed client, then subscribes a second client and finds the same entry in its snapshot. An empty level then leaves an empty list. The other asserts `isActionKnownToVersion` for `chat/backgroundWorkSet` and `chat/backgroundWorkRemoved` at `0.9.0`. The file's `@microsoft/agent-host-protocol` import gained `isActionKnownToVersion` for it.

`packages/sdk/test/nested-proxy.test.ts` gained one case. A scripted inner backend emits `chat/backgroundWorkSet` on its own chat. The client outside reads it on the outer chat's channel, and the outer session's `chatState().resource` is the outer chat URI. The inner session then emits `chat/backgroundWorkRemoved`, and the outer `chatState().backgroundWork` is an empty list. A background action names no chat of its own. What says which chat it is about is the channel it arrives on and the `resource` of the state.

Step 3 was not needed, because no case failed, so `host.ts` is unchanged. The host already passes an unknown chat action through. `nested.ts` renames the chat URIs it carries, and it reduces the action into its mirror. That is why a late subscriber outside reads the entry from the snapshot.
