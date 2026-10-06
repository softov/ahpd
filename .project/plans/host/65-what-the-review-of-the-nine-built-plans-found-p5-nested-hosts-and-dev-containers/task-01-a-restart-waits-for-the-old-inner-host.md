---
title: A restart waits for the old inner host and keeps its session
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/nested.ts#L966-L1000](../../../../packages/sdk/src/nested.ts#L966-L1000) - `close`, which disposes inside only for a removal and settles on the process's end for a restart"
  - "[code://packages/sdk/src/nested.ts#L374-L378](../../../../packages/sdk/src/nested.ts#L374-L378) - `gone`, resolved by the process's own `close` and `error`"
  - "[code://packages/sdk/src/host/lifecycle.ts#L409-L425](../../../../packages/sdk/src/host/lifecycle.ts#L409-L425) - the restart closes each chat without disposing it, and keeps what to wait on"
  - "[code://packages/sdk/src/host/lifecycle.ts#L470-L474](../../../../packages/sdk/src/host/lifecycle.ts#L470-L474) - and waits there, immediately before `spawn`"
  - "[code://packages/sdk/src/types/session.ts#L565-L576](../../../../packages/sdk/src/types/session.ts#L565-L576) - `Session.close`, which now takes whether the session is being removed"
  - "[code://packages/sdk/test/nested-process.test.ts](../../../../packages/sdk/test/nested-process.test.ts) - the case, against a real child"
---

## Objective

When a nested session restarts (a directory added, a folder moved), the old inner host is stopped without disposing its session, the restart waits until its process has exited, and only then starts the new one, which resumes the same inner session.
A removal still disposes the inner session before the host stops.

## Files

- `UPDATE: packages/sdk/src/nested.ts:374-378` - `gone`, a promise the process's own `close` and `error` resolve.
- `UPDATE: packages/sdk/src/nested.ts:966-1000` - `close` takes whether the session is being removed, disposes inside only then, and settles on the process's end for a restart.
- `UPDATE: packages/sdk/src/host/lifecycle.ts:409-425,470-474` - the restart closes each chat with `false`, keeps the promises, and waits on them immediately before `spawn`.
- `UPDATE: packages/sdk/src/types/session.ts:565-576` - `Session.close` takes the flag, so a host may pass it.
- `UPDATE: packages/sdk/test/nested-process.test.ts` - the case below, and `manyDirectories`, the proxy a host offers more than one directory.

## Steps

1. Failing case first: a nested session with one turn; add a directory. Today a second inner process starts before the first has exited; after, the first has exited before the second starts, and the second resumes with the first turn in it.
2. A removal still sends `disposeSession` inside (passes before and after).

## Validation

- The case in step 1 fails on `e1c4ccc` and passes after.
- `pnpm exec vitest run packages/sdk/test/nested-*.test.ts`.

## Resume

Implemented. `nestedSession` now keeps a `gone` promise, resolved by the same two events that set `exited` (`close` and `error` on the process), and `close` is memoised in `closing`: the first caller's `removing` decides, and a second caller waits on the same sequence rather than starting a second one. `removing` disposes the inner session, as `close` always did; a restart passes `false` and keeps the transcript the new host resumes. The promise settles on the process's end only for a restart - that is where the two hosts must not overlap - and otherwise when the sequence has been sent, which is what it was before.

`restart` in `lifecycle.ts` collects `chat.close(false)` into `stopping` beside the `byChat.drop` it already did, and awaits `Promise.all(stopping)` as the last thing before `spawn`, after the machine and worktree juggling. `Session.close` in `types/session.ts` takes the flag; that is where the declaration is, not `types/agent.ts` as the Files list said. A backend that declares `close(): void` still satisfies it, and `teardown` and `Host.close` call it with no argument, so a removal is what they were.

The case was seen failing first at `expect(replacedTooEarly).toBe(false)`: the second `open()` happened while the first child was still alive. It is the last case before the resume case in `nested-process.test.ts` and needs two things a plain proxy does not give it. The host refuses `session/workingDirectorySet` for a backend that works in one directory, so the case starts the proxy through `manyDirectories`, which is the same proxy over an agent that declares `multipleDirectories`. And the transcript is read from the inner host's own store - the fixture writes `<XDG_STATE_HOME>/nested-echo/nested-outer.json` after every completed turn - because that is the ground truth of what the host inside kept, and the first read of it has to wait for the write rather than follow the outer `chat/turnComplete`.

Two halves of the plan's finding could not be shown by this fixture, and the case keeps only what it can. The dispose the old host was sent on a restart does not break the resume here: the request races the SIGTERM and the fixture's store is a file the dispose does not remove, so the transcript assertion passes with and without it - the change is the plan's decision, not a case's. And the wait had to be tied to the restart rather than to every close: `Host.close` collects `chat.close()` into its own bounded race, and the in-memory fakes in `nested-proxy.test.ts` never emit `close` on their stand-in process, so a removal that waited on `gone` made `host.close()` sit out `HOST_CLOSE_WAIT_MS` and time that file's last case out.

Gates: `npx tsc -b` clean, `npx vitest run packages/sdk/test` 106 files and 1490 tests passed.
