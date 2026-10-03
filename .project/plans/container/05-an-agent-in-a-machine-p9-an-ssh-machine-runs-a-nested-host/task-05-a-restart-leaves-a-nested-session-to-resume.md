---
title: A restart of this host leaves a nested session for the next one to resume
status: todo
depends: [task-03-a-session-on-an-ssh-machine-runs-nested.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L7094-L7096](../../../../packages/sdk/src/host.ts#L7094-L7096) - `Host.close`, which closes every chat"
  - "[code://packages/sdk/src/host.ts#L5118-L5121](../../../../packages/sdk/src/host.ts#L5118-L5121) - a working-directory change closes each chat and starts it again"
  - "[code://packages/sdk/src/host.ts#L5249-L5258](../../../../packages/sdk/src/host.ts#L5249-L5258) - `restartChat`, close then resume"
  - "[code://packages/sdk/src/host.ts#L11052](../../../../packages/sdk/src/host.ts#L11052) - a truncate closes the session and starts one behind it"
  - "[code://packages/sdk/src/host.ts#L4952-L4957](../../../../packages/sdk/src/host.ts#L4952-L4957) - `removeSession`, the one session removal"
  - "[code://packages/sdk/src/host.ts#L8991](../../../../packages/sdk/src/host.ts#L8991) - a chat removed by a client"
  - "[code://packages/sdk/src/host.ts#L8894-L8897](../../../../packages/sdk/src/host.ts#L8894-L8897) - `disposeSession`, which removes the session on the inner host"
  - "[code://packages/sdk/src/nested.ts#L511-L524](../../../../packages/sdk/src/nested.ts#L511-L524) - the nested `close`, which asks the inner host to dispose"
  - "[code://.project/plans/daemon/13-ahpd-restart/plan.md](../../daemon/13-ahpd-restart/plan.md) - `ahpd restart` quiesces, ends agents and resumes sessions from the store"
---

## Objective

When this host stops or restarts, or closes a chat only to start it again, a nested session ends its transport without disposing the inner session, so the inner transcript is still there when the session is resumed by id.
Only `removeSession` and a client removing a chat dispose the inner session.

## Files

- `UPDATE: packages/sdk/src/types/session.ts:545` - `close(reason?: 'dispose' | 'stopping')`, default `dispose`.
- `UPDATE: packages/sdk/src/host.ts:7094-7096` - `Host.close` closes with `stopping`.
- `UPDATE: packages/sdk/src/host.ts:5118-5121, 5249-5258, 11052` - the working-directory restart, `restartChat` and the truncate restart close with `stopping`, since each resumes the session right after.
- `UPDATE: packages/sdk/src/host.ts:4957, 8991` - `removeSession` and a chat removal close with `dispose`, named, so the two are the only disposing paths.
- `UPDATE: packages/sdk/src/nested.ts:511-524` - `stopping` skips `disposeSession`, shuts the client down and ends the process.
- `UPDATE: packages/sdk/test/nested-process.test.ts` - made by container/04 task 11.

## Steps

1. Read what `removeSession` deletes on the inner host (the worktree, the stored record) and confirm the inner transcript survives a `stopping` close and is gone after a `dispose`.
2. Keep container/04 task 15's wait for `disposeSession` on the `dispose` path only.
3. An ssh process that loses its connection ends the remote `ahpd --stdio`; its store on the box is what container/04 task 11 resumes from, so nothing more is sent on the way down.

## Validation

- `nested-process.test.ts`: a real inner host serves a turn, the outer host closes, a second outer host resumes the session by id against the same inner store, and the earlier turn is in the snapshot.
- A disposed session is not resumable, as today.
- `nested-proxy.test.ts`: `restartChat`, a working-directory change and a truncate on a nested session send no `disposeSession` to the inner host; `removeSession` and a chat removal send one.

## Resume
