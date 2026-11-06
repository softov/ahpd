---
title: The host fills the connector choices
status: done
depends: [01]
layer: "sdk connectors"
refs:
  - "[code://packages/sdk/src/tunnels/channel.ts#L245-L270](../../../../packages/sdk/src/tunnels/channel.ts#L245-L270) - `operationsOf`"
  - "[code://packages/sdk/src/agents/engines.ts#L50-L80](../../../../packages/sdk/src/agents/engines.ts#L50-L80) - `rowOf`"
  - "[code://packages/sdk/src/host/automations.ts#L1522-L1534](../../../../packages/sdk/src/host/automations.ts#L1522-L1534) - `listAutomationTriggerDefinitions`"
---

## Objective

Each schema the host sends gives a marked field the host's connectors of its adapter as `enum` and `enumLabels`.

## Files

- `UPDATE: packages/sdk/src/connectors/fields.ts` - `withConnectorChoices(schema, served, ask)`.
- `UPDATE: packages/sdk/src/types/connectors.ts:199-206` - `ConnectorRef` carries the connector's `title`.
- `UPDATE: packages/sdk/src/connectors/channel.ts` - the refs carry the title; an `onRefs` option is called when the refs change.
- `UPDATE: packages/sdk/src/tunnels/channel.ts` - the state and the published operations carry the filled inputs; `run` keeps the raw ones.
- `UPDATE: packages/sdk/src/agents/engines.ts` - a `connectors` option; each row's schema is filled and asks.
- `UPDATE: packages/sdk/src/host/automations.ts:1522-1534` - each plugin trigger's config schema is filled and asks.
- `UPDATE: packages/server/src/commands/run.ts` - the engines channel gets the refs; a refs change refreshes the tunnels and engines.

## Steps

1. Add `title` to `ConnectorRef`, and fill it where the connectors channel reads and writes a record.
2. Add `withConnectorChoices`. It copies the schema.
   For each marked field, it sets `enum` to the ids of the host's connectors of that adapter.
   It sets `enumLabels` to their titles. With `ask`, it also sets `enumDynamic: true` and `x-ahpd-completions: { command, ref }`.
3. The tunnels state and its published operations fill create and update inputs without `ask`.
4. The engines rows and the plugin trigger definitions fill with `ask`.
5. Call `onRefs` from the connectors channel when the id, adapter, owner or title of a ref changes. `run.ts` refreshes the tunnels and engines then.

## Validation

- A tunnels snapshot's create input lists the host's devtunnel connectors with their titles.
- An engine row's `logins` items carry `enumDynamic` and `x-ahpd-completions`.
- A person's connector is not in any `enum`.
