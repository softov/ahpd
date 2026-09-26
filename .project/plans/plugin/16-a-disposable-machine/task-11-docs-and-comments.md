---
title: The docs say what a disposable machine does, and the comments document
status: todo
depends: [task-07-a-daemon-adopts-only-its-own-leftovers.md, task-08-a-disposable-alone-machine-refuses-another-session.md, task-10-the-session-folder-needs-the-profiles-flag.md]
layer: "docs"
refs:
  - "[code://packages/sdk/src/types/computers.ts](../../../../packages/sdk/src/types/computers.ts) - `enter`, documented as not called on a pre-turn restart, which `host.ts:3934` does call"
  - "[code://docs/COMPUTER.md](../../../../docs/COMPUTER.md) - the disposable section and its `alone` wording"
---

## Objective

`docs/COMPUTER.md` says what `disposableAlone`, `sessionFolder`, `max` and the startup adoption do now, and the comments on `enter`/`leave` say what the host does.

## Files

- `UPDATE: packages/sdk/src/types/computers.ts` - `enter` and `leave` documented as tasks 05 and 06 leave them.
- `UPDATE: docs/COMPUTER.md` - the disposable section, in the file's own style, no reflow around it.

## Steps

1. Describe behaviour, not history.

## Validation

- By reading: every profile field and rule in this plan is in the docs; no comment says what used to be. No em dashes.

## Resume
