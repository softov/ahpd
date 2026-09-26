---
title: The machine is made when the session starts
status: implemented
depends: [task-01-offered-in-the-picker.md]
layer: "sdk | computer"
refs:
  - "[code://packages/sdk/src/computers.ts](../../../../packages/sdk/src/computers.ts) - where a session opens its computer"
---

## Objective

A session whose `computer` is `disposable:<profile>` makes a machine at start through the port, with the profile, its agent's `machine()` and its folder, and runs as if it had been given the new `computer://<id>`.

## Files

- `UPDATE: packages/sdk/src/computers.ts`
- `UPDATE: packages/sdk/src/types/computers.ts` - a create that takes needs.
- `UPDATE: packages/computer/src/plugin.ts`

## Steps

1. A restart before the first turn reuses the machine it made.
2. A failed create answers the session with the runtime's sentence.

## Validation

- A test against the fake Docker: the machine is made with the agent's needs; a restart does not make a second one.

## Resume

Done 2026-09-26. The port gains `create(asked: MachineSource)`, `enter` and `leave` in `packages/sdk/src/types/computers.ts`; `packages/sdk/src/computers.ts` gains `computerSource`, `computerId` and the one session-time `openComputer`, which is shared with `container/03`. The host's `placedIn` runs it before `openSession` in `createSession` and `startForAutomation`, rewrites the setting to the `computer://<id>` and keeps `sessionMachines` so a re-sent source is the machine already made rather than a fixed key that moved. The plugin's `create` builds through `manifestOf` with `for: <session provider>` and the session folder, and lets the runtime's sentence through. `test/computer-disposable.test.ts` covers the needs, the folder, the labels, the pre-turn restart and a refused create.

