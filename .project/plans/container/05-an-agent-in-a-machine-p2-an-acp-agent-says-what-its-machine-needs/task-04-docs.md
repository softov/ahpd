---
title: The ACP docs cover a preset's machine
status: todo
depends: [task-01-a-spec-declares-what-its-machine-needs.md, task-05-the-hosts-tools-reach-a-machine-only-where-it-can-reach-the-daemon.md]
layer: "docs"
refs:
  - "[code://docs/PLUGINS.md#L662-L712](../../../../docs/PLUGINS.md#L662-L712) - the ACP section"
  - "[code://docs/COMPUTER.md](../../../../docs/COMPUTER.md) - the table of what enters a machine"
---

## Objective

`docs/PLUGINS.md` shows a preset's `machine` option with one example, and `docs/COMPUTER.md` says an ACP preset may declare what its machine needs.

## Files

- `UPDATE: docs/PLUGINS.md` - the ACP section.
- `UPDATE: docs/COMPUTER.md` - the ACP row of the backends table.

## Steps

1. One example of `machine` with `env` (one plain value, one `{ fromEnv }`) and `copy`.
2. One sentence that a `{ "$secret" }` value works wherever the vault is set up, linking the vault's own docs once they exist.
3. One sentence that a session in a machine gets the host's tools only where the machine can reach the daemon, and that the log says when they were left out.

## Validation

- Read by hand against `plugin.ts`.

## Resume
