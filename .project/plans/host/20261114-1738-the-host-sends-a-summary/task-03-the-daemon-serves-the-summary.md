---
title: The daemon serves the summary
status: done
depends: [task-02-the-summary-channel.md]
layer: server
refs:
  - "[code://packages/server/src/commands/run.ts#L1202-L1206](../../../../packages/server/src/commands/run.ts#L1202-L1206) - where the daemon serves its channels"
  - "[code://docs/plugins/PLUGINS.md#L1891-L1907](../../../../docs/plugins/PLUGINS.md#L1891-L1907) - the section the new one follows"
---

## Objective

The daemon serves `x-ahpd-summary://` over the plugins, connectors, agents, tunnels and clients lists, and the docs say what it holds.

## Files

- `UPDATE: packages/server/src/commands/run.ts:1202-1206` - build the summary over the five lists and serve it.
- `UPDATE: packages/server/src/commands/run.ts:1441-1460` - list the `summary` subject beside `client` and `tunnel`.
- `UPDATE: docs/plugins/PLUGINS.md:1907` - add the `x-ahpd-summary` section after `x-ahpd-clients`.

## Steps

1. Count `plugins`, `connectors` and `agents` by `state`, `tunnels` by `status`, and `clients` with no state.
2. Count alerts for plugins, connectors and agents.
3. Serve the summary with the other lists.
4. Stop its timer when the daemon stops.
5. Write the docs section.
6. Start a daemon from this branch on a free port and subscribe to the summary.

## Validation

- The server suite passes.
- A subscribe to `x-ahpd-summary://` on a daemon from this branch answers the five areas.

## Resume

Built as the steps say. The daemon also lists a `summary` subject in its `grants`, because the start said `plugin ahpd requires summary:read, which no entry of ahpd.grants lists`.
