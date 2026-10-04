---
title: A resumed session counts as a user of its disposable machine
status: done
depends: [task-05-a-machine-is-left-when-its-session-moves-away.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L10143](../../../../packages/sdk/src/host.ts#L10143) - a listed session resumed through `spawn`, which never calls `enter`"
  - "[code://packages/sdk/src/host.ts#L3596-L3680](../../../../packages/sdk/src/host.ts#L3596-L3680) - `spawn`, which every road to a running backend calls"
  - "[code://packages/sdk/src/host.ts#L6853-L6863](../../../../packages/sdk/src/host.ts#L6853-L6863) - `openSession`'s `enter`"
  - "[code://packages/sdk/src/host.ts#L5117-L5125](../../../../packages/sdk/src/host.ts#L5117-L5125) - `restart`'s `enter`"
  - "[code://packages/sdk/src/host.ts#L5181-L5200](../../../../packages/sdk/src/host.ts#L5181-L5200) - `restartChat`, another `spawn`"
  - "[code://packages/sdk/src/host.ts#L8845](../../../../packages/sdk/src/host.ts#L8845) - a new or forked chat, another `spawn`"
  - "[code://packages/sdk/src/host.ts#L10901-L10910](../../../../packages/sdk/src/host.ts#L10901-L10910) - a truncate, another `spawn`"
---

## Objective

Every road that starts a backend in a machine counts the session as a user of it, so a session resumed after a daemon restart holds its disposable machine.
Today a listed session resumed through `spawn` never calls `enter`, and the machine is removed about five minutes later while the session runs in it.

## Files

- `UPDATE: packages/sdk/src/host.ts:3596-3680` - `spawn` calls `enter(computerId(config.computer), uri)` once the backend is created, and records the machine as task 05's map does.
- `UPDATE: packages/sdk/src/host.ts:6853-6863`, `:5117-5125` - the two `enter` calls and their comments go, since `spawn` now does it.
- `UPDATE: packages/computer/test/computer-disposable.test.ts` - the case below.

## Steps

1. The roads that call `spawn` are `openSession`, `restart`, `restartChat`, a new or forked chat, the resume of a listed session, a truncate and a session tool's `createChat`; with `enter` in `spawn` each of them counts, and none needs its own call.
2. `enter` stays a set in the plugin, so a road taken twice for one session is still one user.
3. A pre-turn restart onto a different machine leaves the old one first (task 05), then `spawn` enters the new one.

## Validation

- A disposable machine found at startup and a kept session resumed into it from the list: past `disposableDelay` the fake Docker sees no `rm` while the session lives, and sees it after the session is disposed. Today `rm` comes while it runs, so the case fails.
- The existing cases (removal after the last session, cancel on a new pick, the pre-turn restart) still pass.

## Resume
