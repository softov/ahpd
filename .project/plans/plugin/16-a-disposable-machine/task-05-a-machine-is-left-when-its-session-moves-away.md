---
title: A disposable machine is left when its session moves away before the first turn
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L4970-L4978](../../../../packages/sdk/src/host.ts#L4970-L4978) - dispose, which computes `leave` from the session's config as it is now"
  - "[code://packages/sdk/src/host.ts#L5025-L5135](../../../../packages/sdk/src/host.ts#L5025-L5135) - `restart`: `sessions.delete`, then `placedIn`, then `spawn`, then `enter` for the new machine, and no `leave` anywhere"
  - "[code://packages/sdk/src/host.ts#L5304-L5334](../../../../packages/sdk/src/host.ts#L5304-L5334) - `placedIn`, which returns early for a value that is not a source and leaves `sessionMachines` as it was"
  - "[code://packages/sdk/src/host.ts#L1715](../../../../packages/sdk/src/host.ts#L1715) - `sessionMachines`, kept only for a machine made from a source"
  - "[code://packages/sdk/src/host.ts#L6862-L6863](../../../../packages/sdk/src/host.ts#L6862-L6863) - `enter` at session creation"
---

## Objective

A session that picked `disposable:<profile>` and then moves to another computer, or to this host, before its first turn leaves the machine it was made for, so the removal delay starts.
Today `restart` never calls `leave` for the old machine, and dispose computes `leave` from the new config, so the machine holds that session forever; the same happens when `placedIn` refuses the new value after `sessions.delete` has run.
And a session that moved to this host and then picks the same source again is handed the machine it left, because `placedIn` returned early on the way out and `sessionMachines` still names it.

## Files

- `UPDATE: packages/sdk/src/host.ts:1715` - beside `sessionMachines`, a map from session to the machine id it entered, documented.
- `UPDATE: packages/sdk/src/host.ts:6862-6863`, `:5124-5125` - each `enter` records the machine in that map.
- `UPDATE: packages/sdk/src/host.ts:4970-4978` - dispose leaves the machine the map names, not the one the config names now, and drops both entries.
- `UPDATE: packages/sdk/src/host.ts:5025-5135` - `restart` leaves the entered machine when the session will run somewhere else, before `spawn`, and also on the path where `placedIn` or `spawn` throws; when it leaves, it drops the session's `sessionMachines` entry too.
- `UPDATE: packages/computer/test/computer-disposable.test.ts` - the cases below.

## Steps

1. Record per session the machine it entered, at the two places `enter` is called today; task 06 moves both into `spawn` and keeps the record there.
2. In `restart`, compare the entered machine with `computerId` of the config after `placedIn`; when they differ, `leave(old, uri)` and forget the session's `sessionMachines` entry before `enter` on the new one.
3. In the catch, the old backend is already gone, so the entered machine is left there too.
4. A restart onto the same machine (a re-sent source, an `isolation` change) leaves nothing and enters again, which the plugin's set does not count twice.

## Validation

- A session picks `disposable:s`, then switches `computer` to this host before its first turn; with the fake clock advanced past `disposableDelay`, the fake Docker sees `rm` for the machine. Today no `rm` is called, so the case fails.
- The same when the new value is refused by `placedIn`.
- A session that moved to this host and then picks `disposable:s` again gets a new machine, and the first one is removed after the delay.
- The existing pre-turn restart case (the same source re-sent) still makes one machine and starts no timer.

## Resume
