---
title: It goes after the last session, unless picked again
status: todo
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
