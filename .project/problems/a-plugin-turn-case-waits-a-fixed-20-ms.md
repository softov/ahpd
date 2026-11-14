---
title: A plugin turn case waits a fixed 20 ms for its echo
status: open
date: 2026-11-14
severity: minor
refs:
  - "[code://packages/sdk/test/plugin-own-sessions.test.ts#L90-L106](../../packages/sdk/test/plugin-own-sessions.test.ts#L90-L106) - the case, which sleeps 20 ms and then asserts the echo"
  - git://0d95f584c - plugin/20261114-1455 t02, which added the case
---

## Symptom

`lets a plugin with no grants send a turn on a chat of its own agent` failed once in a whole `packages/sdk` run on 2026-11-14.
The run was at `a5effff43` with plan host/20261114-1602 applied in a worktree, under the vitest lock.
It failed on line 105: no `chat/turnStarted` echo was in `heard`.
The file then passed three runs out of three on its own, on the same tree.

## Cause

The case sends `dispatchAction` as a notification, waits a fixed 20 ms, and then asserts the echo.
Under the load of the whole suite, the echo can arrive after 20 ms.

## Impact

The `packages/sdk` suite and the `check` jobs can fail at random on this case.

## Workaround

Run the file again on its own.

## Fix

- Wait for the echo in `heard`, with a bound such as 2 seconds, in place of the fixed sleep.
- Or send the turn as a request where the host answers one, and assert after the answer.
