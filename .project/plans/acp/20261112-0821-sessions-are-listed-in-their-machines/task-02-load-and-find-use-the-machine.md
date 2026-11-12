---
title: Load and find use the machine
status: implemented
depends:
  - task-01-the-listing-runs-in-its-machines.md
layer: "agent-acp"
refs:
  - "[code://packages/agent-acp/src/catalog.ts#L452](../../../../packages/agent-acp/src/catalog.ts#L452) - `loadedSession`"
  - "[code://packages/agent-acp/src/catalog.ts#L609-L646](../../../../packages/agent-acp/src/catalog.ts#L609-L646) - `findListed` and `rowsForFind`"
---

## Objective

`loadedSession` and `findListed` spawn in the machine the session ran in, and on the host only for a host session.

## Files

- `UPDATE: packages/agent-acp/src/catalog.ts:452` - `loadedSession` takes the session's machine.
- `UPDATE: packages/agent-acp/src/catalog.ts:609-646` - `findListed` passes the machines from task 01.
- `UPDATE: packages/agent-acp/test/` - cases for a replay and a find of a machine session.

## Steps

1. Give `loadedSession` an optional `machine` parameter, as `forgetSession` has.
2. Spawn through `machine.computers.how` when the caller gives a machine.
3. Pass the session's machine from the caller that replays it.
4. Pass the machines from task 01 through `rowsForFind`.
5. Write the cases.

## Validation

- The new cases: a replay and a find of a machine session make no host spawn.
- `pnpm typecheck` and the agent-acp suite pass.

## Resume

Built 2026-11-12.

`loadedSession` takes the session's machine and spawns through it; `transcript` reads the machine the listing remembered.
`rowsForFind` reads the machines and the host flag of the last `list` of its record.
The cases are in `packages/agent-acp/test/agent-acp-machines.test.ts`.
