---
title: The pages say what a session in a machine needs
status: done
depends:
  - task-01-a-machine-can-see-a-workspace.md
  - task-03-acp-spawns-through-the-machine.md
layer: docs
refs:
  - "[code://docs/COMPUTER.md](../../../../docs/COMPUTER.md) - the operator's page"
  - "[code://docs/DAEMON.md](../../../../docs/DAEMON.md) - the keys, where `advancedTools` lands"
  - "[code://docs/PLUGINS.md](../../../../docs/PLUGINS.md) - the registration list, where `registerComputers` and `registerSessionConfig` land"
  - "[code://docs/USERS.md](../../../../docs/USERS.md) - the grant table, where `computer:write` is explained"
  - "[code://README.md](../../../../README.md) - the feature list"
---

## Objective

The pages say, in one place each: how a person makes, uses and destroys a machine, what a session needs to run in one, what the daemon key does, and what isolation a container is and is not.

## Files

- `UPDATE: docs/COMPUTER.md` - the lifecycle with the resource commands, the manifest fields, the session key, the port, and the by-hand case.
- `UPDATE: docs/DAEMON.md` - `advancedTools` in the keys and the options table.
- `UPDATE: docs/PLUGINS.md` - `registerSessionConfig` and `registerComputers` in the registration list.
- `UPDATE: docs/USERS.md` - `computer:read`/`computer:write` in the grant table, and that a role without the write half cannot make or destroy one.
- `UPDATE: README.md` - one line for the computer's lifecycle.
- `UPDATE: .project/working/HANDOFF.md` - the plans, the decisions and what is not built.

## Steps

1. Lead `docs/COMPUTER.md` with what a person does, since that is the audience: make, list, read, destroy, and name one for a session.
2. Say what the three model tools are for now, and that they are off until `advancedTools`.
3. Say plainly that a bind mount is the host's filesystem visible in the machine and that the container is the isolation, not a boundary this host enforces.
4. Put the by-hand case at the end, so a reader who wants a session in a machine can repeat it.
5. Keep every page to links for the parts another page owns.

## Validation

- The docs link check over `.project` and `docs` is clean.
- Every flag and key a page names is one the code reads, checked by reading the parser.
- `pnpm test` green, since no code changed.

## Resume

Not started.
