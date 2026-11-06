---
title: One connector check for every save
status: done
depends: []
layer: "sdk connectors"
refs:
  - "[code://packages/sdk/src/agents/channel.ts#L612-L640](../../../../packages/sdk/src/agents/channel.ts#L612-L640) - `refuseConnectors`"
  - "[code://packages/sdk/src/automations/automations.ts#L331-L398](../../../../packages/sdk/src/automations/automations.ts#L331-L398) - `checkReferences`"
  - "[code://packages/sdk/src/tunnels/channel.ts#L405-L460](../../../../packages/sdk/src/tunnels/channel.ts#L405-L460) - tunnel create and update"
---

## Objective

The agent put, the automation save and the tunnel save check a marked field with one function.

## Files

- `CREATE: packages/sdk/src/connectors/fields.ts` - `markedAdapter`, `sameOwnerOrHost` and `connectorRefusal`.
- `UPDATE: packages/sdk/src/agents/channel.ts:612-640` - `refuseConnectors` calls `connectorRefusal`.
- `UPDATE: packages/sdk/src/automations/automations.ts:84-99,331-398` - `sameOwnerOrHost` moves; `checkReferences` calls `connectorRefusal`.
- `UPDATE: packages/sdk/src/tunnels/channel.ts` - a `connectors` option; create and update refuse a field that names no host connector.
- `UPDATE: packages/server/src/commands/run.ts:951-957` - the tunnels channel gets `connectorLists.refs()`.
- `UPDATE: packages/sdk/src/index.ts` and the importers of `sameOwnerOrHost` - import it from `connectors/fields.ts`.
- `CREATE: packages/sdk/test/connector-fields.test.ts` - the tunnel save refuses an unknown connector and a person's connector.

## Steps

1. Move `markedAdapter` and `sameOwnerOrHost` to `connectors/fields.ts`.
2. Add `connectorRefusal(config, schema, served, owner)`. It reads each marked field, and each field with marked items.
   It answers the first wrong value: the field, the id, the adapter and the connector it found.
3. The agent put and the automation save phrase their own sentence from it, so their messages stay the same.
4. Give `TunnelsChannelOptions` a `connectors?()` option. Create and update check with owner `undefined`, which reaches the host's connectors only.
5. Wire the option in `run.ts`.

## Validation

- The agents, automations, references and tunnels tests pass.
- The host refuses a tunnel create that names `asd`.
  The message is "connector names asd, and this host serves no devtunnel connector with that id".
