---
title: A restart of this host leaves a nested session for the next one to resume
status: todo
depends: [task-03-a-session-on-an-ssh-machine-runs-nested.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L6975-L6986](../../../../packages/sdk/src/host.ts#L6975-L6986) - `Host.close`, which closes every chat"
  - "[code://packages/sdk/src/host.ts#L8894-L8897](../../../../packages/sdk/src/host.ts#L8894-L8897) - `disposeSession`, which removes the session on the inner host"
  - "[code://packages/sdk/src/nested.ts#L511-L524](../../../../packages/sdk/src/nested.ts#L511-L524) - the nested `close`, which asks the inner host to dispose"
  - "[code://.project/plans/daemon/13-ahpd-restart/plan.md](../../daemon/13-ahpd-restart/plan.md) - `ahpd restart` quiesces, ends agents and resumes sessions from the store"
---

## Objective

When this host stops or restarts, a nested session ends its transport without disposing the inner session, so the inner transcript is still there when the next daemon resumes the session by id.

## Files

- `UPDATE: packages/sdk/src/types/session.ts:542` - `close(reason?: 'dispose' | 'stopping')`, default `dispose`.
- `UPDATE: packages/sdk/src/host.ts:6975-6986` - `Host.close` closes with `stopping`.
- `UPDATE: packages/sdk/src/nested.ts:511-524` - `stopping` skips `disposeSession`, shuts the client down and ends the process.
- `UPDATE: packages/sdk/test/nested-process.test.ts` - made by container/04 task 11.

## Steps

1. Read what `removeSession` deletes on the inner host (the worktree, the stored record) and confirm the inner transcript survives a `stopping` close and is gone after a `dispose`.
2. Keep container/04 task 15's wait for `disposeSession` on the `dispose` path only.
3. An ssh process that loses its connection ends the remote `ahpd --stdio`; its store on the box is what container/04 task 11 resumes from, so nothing more is sent on the way down.

## Validation

- `nested-process.test.ts`: a real inner host serves a turn, the outer host closes, a second outer host resumes the session by id against the same inner store, and the earlier turn is in the snapshot.
- A disposed session is not resumable, as today.

## Resume
