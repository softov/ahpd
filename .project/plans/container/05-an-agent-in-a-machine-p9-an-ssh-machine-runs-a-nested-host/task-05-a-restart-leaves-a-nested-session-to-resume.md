---
title: A restart of this host leaves a nested session for the next one to resume
status: todo
depends: [task-03-a-session-on-an-ssh-machine-runs-nested.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L844-L846](../../../../packages/sdk/src/host.ts#L844-L846) - `Host.close`, which closes every chat"
  - "[code://packages/sdk/src/host/lifecycle.ts#L269-L272](../../../../packages/sdk/src/host/lifecycle.ts#L269-L272) - a working-directory change closes each chat and starts it again"
  - "[code://packages/sdk/src/host/lifecycle.ts#L422-L443](../../../../packages/sdk/src/host/lifecycle.ts#L422-L443) - `restartChat`, close then resume"
  - "[code://packages/sdk/src/host/chatactions.ts#L1000-L1014](../../../../packages/sdk/src/host/chatactions.ts#L1000-L1014) - a truncate closes the session and starts one behind it"
  - "[code://packages/sdk/src/host/lifecycle.ts#L95-L104](../../../../packages/sdk/src/host/lifecycle.ts#L95-L104) - `removeSession`, the one session removal"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L701-L706](../../../../packages/sdk/src/host/sessionmethods.ts#L701-L706) - a chat removed by a client"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L720-L723](../../../../packages/sdk/src/host/sessionmethods.ts#L720-L723) - `disposeSession`, which removes the session on the inner host"
  - "[code://packages/sdk/src/nested.ts#L511-L524](../../../../packages/sdk/src/nested.ts#L511-L524) - the nested `close`, which asks the inner host to dispose"
  - "[code://.project/plans/daemon/13-ahpd-restart/plan.md](../../daemon/13-ahpd-restart/plan.md) - `ahpd restart` quiesces, ends agents and resumes sessions from the store"
---

## Objective

When this host stops or restarts, or closes a chat only to start it again, a nested session ends its transport without disposing the inner session, so the inner transcript is still there when the session is resumed by id.
Only `removeSession` and a client removing a chat dispose the inner session.

## Files

- `UPDATE: packages/sdk/src/types/session.ts:545` - `close(reason?: 'dispose' | 'stopping')`, default `dispose`.
- `UPDATE: packages/sdk/src/host.ts:844-846` - `Host.close` closes with `stopping`.
- `UPDATE: packages/sdk/src/host/lifecycle.ts:269-272, 422-443` - the working-directory restart and `restartChat` close with `stopping`, since each resumes the session right after.
- `UPDATE: packages/sdk/src/host/chatactions.ts:1000-1014` - the truncate restart closes with `stopping`, since it resumes the session right after.
- `UPDATE: packages/sdk/src/host/lifecycle.ts:95-104` - `removeSession` closes with `dispose`, named.
- `UPDATE: packages/sdk/src/host/sessionmethods.ts:701-706` - a chat removal closes with `dispose`, named, so the two are the only disposing paths.
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
