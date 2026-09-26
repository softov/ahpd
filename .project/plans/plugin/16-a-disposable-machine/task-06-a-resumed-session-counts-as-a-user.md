---
title: A resumed session counts as a user of its disposable machine
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L8025](../../../../packages/sdk/src/host.ts#L8025) - a listed session resumed through `spawn`, which never calls `enter`"
  - "[code://packages/sdk/src/host.ts#L5334](../../../../packages/sdk/src/host.ts#L5334) - where `openSession` calls `enter`"
---

## Objective

Every road that starts a session in a machine calls `enter`, so a session resumed after a daemon restart holds its disposable machine.
Today a listed session resumed through `spawn` never calls `enter`, and the machine is removed about five minutes later while the session runs in it.

## Files

- `UPDATE: packages/sdk/src/host.ts` - `enter` moves to the one place every road to a running backend passes, or each road calls it.
- `UPDATE: test/computer-disposable.test.ts` - the case below.

## Steps

1. List the roads that start a backend (`openSession`, the resume in `applyDispatch`, `restart`, `restartChat`) and make each end in `enter` for the session's machine.
2. `enter` stays a set, so a road taken twice is still one user.

## Validation

- A disposable machine found at startup and a kept session resumed into it: past `disposableDelay` the fake Docker sees no `rm` while the session lives, and sees it after the session is disposed. Today `rm` comes while it runs, so the case fails.

## Resume
