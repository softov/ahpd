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
- `computer-plugin.test.ts`: `starts, stops and restarts a machine by writing what it should be`, in a later run with a load average of 8

The adopted container case also timed out alone, on main at `b4ad32951` and on the bot-talk branch, while the load was near 5.

On 2026-11-13 the adopted container case and `reads a dev container's vault-named need again after a restart` timed out alone, at `46cec859d` and at `74b138b73`, with a load average of 1.5. So a busy machine is not the whole cause.

On 2026-11-14, in a full run with a load average near 6, `computer-libvirt.test.ts`: `suspends and resumes a VM through its state, with a stretch closed at each hold` and `computer-state-seed.test.ts`: `seeds a state volume once, again only for a seed that changed, and keeps what the agent wrote` timed out at 5000 ms. Both files passed alone at `0d95f584c`.

On 2026-11-13 `computer-disposable.test.ts`: `takes the machine's own git volume with it, and asks for none where the profile leaves it open` timed out alone the same way, at `2bf97a6c1`.

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
