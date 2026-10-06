---
title: A machine made under bind is replaced, not entered
status: todo
depends: [task-02-a-machine-gets-a-git-directory-of-its-own.md]
layer: "computer"
refs:
  - "[code://packages/computer/src/runtime.ts#L2164-L2172](../../../../packages/computer/src/runtime.ts#L2164-L2172) - `remove`"
  - "[code://packages/computer/src/plugin.ts#L1300-L1302](../../../../packages/computer/src/plugin.ts#L1300-L1302) - where a session's machine is made"
---

## Objective

A machine with no `ahpd.git` label whose mounts hold a writable bind inside its session's git directory is never adopted or entered: ahpd removes it, the session is told `<machine> was made with the host's git directory writable, so it was removed; the next turn makes a new one`, and the next start makes a `fetch` machine.

## Files

- `UPDATE: packages/computer/src/runtime.ts` - `madeUnderBind(record)`: no `ahpd.git` label and a `Mounts` entry with `RW: true` whose source is the git directory or inside it.
- `UPDATE: packages/computer/src/plugin.ts` - adoption at startup and entering a session skip such a machine and remove it, with the sentence above in the log and to the session.
- `UPDATE: packages/computer/test/computer-disposable.test.ts` - scripted Docker records with and without the label.

## Steps

1. Failing case first: a scripted record with a writable `<gitDir>/logs` bind and no label is adopted today.
2. Detect, remove, tell; no `bringBack`, since its commits are already in the host's repository.
3. Planted links are what task 02's refusal catches on the next start.

## Validation

- `computer-disposable.test.ts`: the old machine is removed and not entered; a labelled `fetch` machine and an `open` machine are entered as before; the next start makes a `fetch` machine; a link left under `logs/` refuses it naming the link.
- `npx vitest run packages/computer` passes.

## Resume
