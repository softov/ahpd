---
title: The listing runs in its machines
status: todo
depends: []
layer: "sdk, agent-acp"
refs:
  - "[code://packages/sdk/src/host/catalogue.ts#L1266-L1273](../../../../packages/sdk/src/host/catalogue.ts#L1266-L1273) - the call to `list()`"
  - "[code://packages/agent-acp/src/catalog.ts#L309-L363](../../../../packages/agent-acp/src/catalog.ts#L309-L363) - the spawn in a machine to copy"
---

## Objective

`catalogueOf` lists in each machine where the agent has kept sessions.
It lists on the host only when a kept session ran there, or none is kept.

## Files

- `UPDATE: packages/sdk/src/types/host.ts` - the agent's `list` takes the machines of its kept sessions.
- `UPDATE: packages/sdk/src/host/catalogue.ts:1266-1273` - pass each agent the machines from its kept rows, read as `ranIn` reads them.
- `UPDATE: packages/agent-acp/src/agent.ts:180` - `list` passes the machines on.
- `UPDATE: packages/agent-acp/src/catalog.ts:481-590` - `listingFor` and `catalogueOf` spawn per machine through `computers.how`, and merge the rows.
- `UPDATE: packages/agent-acp/test/` - cases for machine-only, host-only and mixed agents.

## Steps

1. Add an optional `machines` parameter to the agent's `list`, typed as `SessionMachine[]`.
2. In the catalogue, collect the machine of each kept row of the agent, and whether one ran on the host.
3. In `catalogueOf`, spawn through `computers.how` for each running machine, as `forgetSession` does.
4. Spawn on the host only when a kept row ran there, or the agent has no kept row.
5. Merge the rows of every spawn with the watched rows.
6. Write the agent-acp cases with a fake computers port.

## Validation

- The new case for a machine-only agent sees no host spawn.
- The new cases for a host agent and a mixed agent see today's rows and both sets of rows.
- `pnpm typecheck` passes.

## Resume
