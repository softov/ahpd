---
title: It goes after the last session, unless picked again
status: implemented
depends: [task-02-made-at-session-start.md]
layer: "computer"
refs:
  - "[code://packages/computer/src/plugin.ts](../../../../packages/computer/src/plugin.ts) - the plugin that owns the machines"
---

## Objective

The plugin counts sessions per disposable machine, starts the delay when the count reaches zero, cancels it when a session picks the machine, removes it when it fires, keeps `disposableAlone` machines out of the picker, and at startup gives any labelled leftover the delay again.

## Files

- `UPDATE: packages/computer/src/plugin.ts`

## Steps

1. The count moves on session start and dispose, never on a pre-turn restart.

## Validation

- Fake timers: removal after the delay, cancel on a new pick, alone never offered, leftovers picked up at startup.

## Resume

Done 2026-09-26. `packages/computer/src/plugin.ts` keeps `disposables`, counts sessions through the port's `enter`/`leave` (which the host calls at `openSession` and `removeSession`, never on a pre-turn restart), arms the profile's delay on the last leave, cancels it on the next enter and removes through the runtime when it fires. `disposableAlone` machines are filtered out of the answerer, and a labelled machine found by a startup `list()` is given the delay again. `packages/computer/src/runtime.ts` carries the profile and alone flag as `ahpd.disposable` and `ahpd.disposable.alone` labels and reads them back from `list` and `inspect`; `test/fixtures/docker.mjs` records them and now writes its state atomically. `test/computer-disposable.test.ts` covers removal, the cancel, alone, the leftover and the pre-turn restart under fake timers.

