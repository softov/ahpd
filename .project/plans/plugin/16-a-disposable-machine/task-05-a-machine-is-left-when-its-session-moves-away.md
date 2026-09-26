---
title: A disposable machine is left when its session moves away before the first turn
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L3790-L3800](../../../../packages/sdk/src/host.ts#L3790-L3800) - dispose, which computes `leave` from the session's current config"
  - "[code://packages/sdk/src/host.ts#L3841-L3940](../../../../packages/sdk/src/host.ts#L3841-L3940) - `restart`: `sessions.delete`, then `placedIn`, then `enter` for the new machine"
  - "[code://packages/sdk/src/host.ts#L5334](../../../../packages/sdk/src/host.ts#L5334) - `enter` at session creation"
---

## Objective

A session that picked `disposable:<profile>` and then moves to another computer, or to this host, before its first turn leaves the machine it was made for, so the removal delay starts.
Today the restart never calls `leave` for the old machine, and dispose computes `leave` from the new config, so the machine holds that session forever; the same happens when `placedIn` refuses the new source after `sessions.delete` has run.

## Files

- `UPDATE: packages/sdk/src/host.ts` - `restart` calls `leave(old, uri)` when the machine changes, including on the path where `placedIn` throws; dispose leaves the machine the session was last entered into, not the one its config names now.
- `UPDATE: test/computer-disposable.test.ts` - the cases below.

## Steps

1. Record per session the machine it entered (the host already has `sessionMachines`), and make `leave` read that record.
2. On a restart onto a different machine, `leave` the old one before `enter` on the new.
3. On a restart whose `placedIn` refuses, the old machine is still left.

## Validation

- A session picks `disposable:s`, then switches `computer` to this host before its first turn; with the fake clock advanced past `disposableDelay`, the fake Docker sees `rm` for the machine. Today no `rm` is called (the review's probe), so the case fails.
- The same when the new source is refused by `placedIn`.

## Resume
