---
title: A machine knows who created it
status: todo
depends: []
layer: "sdk, computer"
refs:
  - "[code://packages/sdk/src/types/computers.ts](../../../../packages/sdk/src/types/computers.ts) - `MachineSource`"
  - "[code://packages/sdk/src/host.ts#L4170-L4200](../../../../packages/sdk/src/host.ts#L4170-L4200) - `ownerFor` and `charged`, what the host knows of a session's owner and scope"
---

## Objective

`MachineSource` gains `owner?: Owner`, `team?` and `project?`, filled by the host from the session that asks for the machine.
The direct path (a person creating a `computer://` resource) hands the creating connection's owner the same way, through whatever that path already passes to the plugin.
The computer plugin stores them as labels on the machine (`ahpd.owner`, `ahpd.team`, `ahpd.project`) in both runtimes, and reads them back with the machine.

## Files

- `UPDATE: packages/sdk/src/types/computers.ts`, `packages/sdk/src/host.ts` - the fields and who fills them.
- `UPDATE: packages/computer/src/plugin.ts`, `packages/computer/src/devcontainer.ts` - the labels.

## Validation

- `packages/sdk/test/`: a session-made machine's source carries the session's owner and scope; a direct create carries the connection's owner.
- `packages/computer/test/`: the labels are written at create and read back.

## Resume
