---
title: The README lists the tools
status: implemented
depends: [task-03-the-tools-change-with-the-clients.md]
layer: "docs"
refs:
  - "[code://packages/agent-pi/README.md#L44-L60](../../../../packages/agent-pi/README.md#L44-L60) - what maps and what does not"
---

## Objective

`packages/agent-pi/README.md` says that host and client tools reach pi, and when a client's tools take effect.

## Files

- `UPDATE: packages/agent-pi/README.md:44-60` - one bullet under what maps, for host and client tools, and the tool-confirmation bullet saying a host tool is not asked about either.

## Steps

1. Add the bullet in the file's own style, with no em dashes.
2. Say when a client's tools take effect, as task 03 built it.

## Validation

- Read against the code once tasks 01 to 03 are done.

## Resume

Built.
`packages/agent-pi/README.md` has a bullet under what maps: the host's tools are offered to pi's model and one of them runs in the host, a client's tool is offered and a call to it waits for that client, and a client's tools take effect from the next turn because pi is restarted on the same file.
The tool-confirmation bullet was left as it stands; plan 09 task 03 rewrites it once pi asks.

- Validation was reading the bullet against the code in tasks 01 to 03; no code or test changed.
- `pnpm test` 102 files, 1364 tests; `pnpm typecheck` and `pnpm boundary` green.
