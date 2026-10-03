---
title: The hub lists a node as a computer
status: todo
depends: [task-02-a-joined-socket-is-a-nested-host.md]
layer: "computer"
refs:
  - "[code://packages/sdk/src/plugins.ts#L393](../../../../packages/sdk/src/plugins.ts#L393) - one `computers` port"
  - "[code://packages/computer/src/plugin.ts#L648-L662](../../../../packages/computer/src/plugin.ts#L648-L662) - the port the plugin registers"
---

## Objective

`@ahpd/computer` serves a `node` runtime through p9's router that lists the hub's nodes (status `Up` while connected), answers `remote` true and `connect` through the registry, and refuses every verb that would make, start or stop one.

## Files

- `CREATE: packages/computer/src/node.ts` - the runtime, reading the registry the host hands plugins.
- `UPDATE: packages/sdk/src/types/host.ts` - the node registry on the plugin host, read-only.
- `UPDATE: packages/computer/src/plugin.ts` - registered with the router; `connect` on the port.

## Steps

1. A node's id is `node.<name>`, through p9 task 01's `spellMachineId`.
2. A node is owned by the host and, like p9's ssh machines, its up time is metered: a stretch opens when it connects and closes when its control socket drops, by p9 task 01's rule for a runtime that only lists.
3. The nested start carries p12's token and proxy URL, so no key reaches the node.

## Validation

- `computer-plugin.test.ts`: a registry with one connected node lists `node.<name>`; `connect` reaches the registry; `remote` is true.
- The same file: a node that connects and then drops writes one stretch charged to the host.

## Resume
