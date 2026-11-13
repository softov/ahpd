---
title: Computer cases time out on a busy machine
status: open
date: 2026-11-13
severity: minor
blocks: []
refs:
  - "[code://packages/computer/test/computer-devcontainer.test.ts#L1616](../../packages/computer/test/computer-devcontainer.test.ts#L1616) - three connects through the fake CLIs, under the default 5 s limit"
  - "[problems/a-disposable-machine-case-fails-at-random.md](a-disposable-machine-case-fails-at-random.md) - the disposable case of the same run"
  - git://0e0fea92b - main when the problem was read
---

## Symptom

Seen on 2026-11-13 on Softov's machine, with a load average of 11 on 8 cores.
In one run of the computer suite these cases timed out at 5000 ms:

- `computer-devcontainer.test.ts`: `finds an adopted container again by its folder, on a second connect and after a restart`
- `computer-devcontainer.test.ts`: `does not hand back an image built without a part the file now has`
- `computer-needs.test.ts`: `makes the machine without a part whose load fails, and refuses only the session that needs it`
- `computer-parts-mount.test.ts`: `writes the time a machine used a part volume into its marker, and again once an hour has passed`

The adopted container case also timed out alone, on main at `b4ad32951` and on the bot-talk branch, while the load was near 5.

## Cause

Each connect starts the fake `docker` and `devcontainer` CLIs as node processes.
A case with three connects needs more than 5 s when the machine is busy.

## Impact

The suite is red on a busy machine for no fault in the code.

## Workaround

None. A second run is not a fix.

## Fix

- Give the cases that start the fake CLIs a longer timeout of their own.
- Or start fewer processes in each case.
