---
title: Every suite holds the held state
status: done
depends: [01, 02, 03, 04]
layer: "sdk tests, docs"
refs:
  - "[code://packages/sdk/test/host-snapshots.test.ts](../../../../packages/sdk/test/host-snapshots.test.ts) - what each snapshot carries"
  - "[code://docs/sdk/HOST.md](../../../../docs/sdk/HOST.md) - the root's `_meta`, and where the restart mark is read"
  - "[code://docs/sdk/AHP.md](../../../../docs/sdk/AHP.md) - the host's rows for each action it answers"
---

## Objective

Every suite passes against the held state, and the documents say how the state moves.
A test that read a field no action moves now reads the action that moves it, or the field as its seed holds it.

## Files

- `UPDATE: packages/sdk/test/` - each case that read a field moved with no action.
- `UPDATE: docs/sdk/HOST.md` - the root's `_meta`, and the restart mark on the handshake.
- `UPDATE: docs/plugins/PLUGINS.md` - where a plugin's restart mark is read.
- `UPDATE: docs/sdk/AHP.md` - a snapshot is the held state; a chat's row, the session's activity and status.

## Steps

1. Run `pnpm run test:unit --maxWorkers=2`, and rerun each failure alone.
2. Change a case only where it read a field the held state now leaves to an action.
3. Say each field that moves by an action in the documents that list them.
4. Run `pnpm run typecheck` and `pnpm run boundary`, and fix every error they name.

## Validation

- `pnpm run test:unit --maxWorkers=2` passes, with each failure under load passing alone.
- `pnpm run typecheck` and `pnpm run boundary` exit 0.

## Resume

Done; [implemented.md](implemented.md) says what was built.
