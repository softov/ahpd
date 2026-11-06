---
title: A plugin option picks from the connectors
created: 2026-11-05
refs:
  - git://4a5885fc - the commit of ahpd the facts were checked at
  - git://14beb809 - the merge of #207, which marks, fills and checks a connector field on a record's form
  - "[code://packages/tunnel-devtunnel/package.json#L92](../../packages/tunnel-devtunnel/package.json#L92) - the Dev Tunnels plugin's `connector` option, a string with no mark"
  - "[code://packages/tunnel-devtunnel/src/kind.ts#L57-L63](../../packages/tunnel-devtunnel/src/kind.ts#L57-L63) - a tunnel record's `connector`, marked `x-ahpd-connector`"
  - "[code://packages/tunnel-devtunnel/src/plugin.ts#L169](../../packages/tunnel-devtunnel/src/plugin.ts#L169) - the plugin reads its `connector` option"
  - "[code://packages/sdk/src/connectors/fields.ts#L36](../../packages/sdk/src/connectors/fields.ts#L36) - `markedAdapter`, which reads the mark"
  - "[code://packages/sdk/src/connectors/fields.ts#L80](../../packages/sdk/src/connectors/fields.ts#L80) - `connectorRefusal`, the check a save runs"
  - "[code://packages/sdk/src/connectors/fields.ts#L131](../../packages/sdk/src/connectors/fields.ts#L131) - `withConnectorChoices`, which fills `enum` and `enumLabels`"
  - "[code://packages/server/src/pluginschannel.ts#L339](../../packages/server/src/pluginschannel.ts#L339) - a plugin row carries its `optionsSchema` as the manifest gives it"
  - "[code://packages/server/src/pluginschannel.ts#L735-L760](../../packages/server/src/pluginschannel.ts#L735-L760) - `x-ahpd/plugins/options` checks a value against the option's schema only"
  - https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-session/state.ts - `enumDynamic`, which says a field's `enum` holds seed values and the full list comes from the host
  - git://dcd9063 - scena's commit, in 0.5.18, that draws a field with `enum` as a picker labelled by `enumLabels`
---

# A plugin option picks from the connectors

Softov wants the Dev Tunnels plugin's own `connector` option to be a list of connectors to pick from. A tunnel record's form already has one. Today the plugin's options page draws it as a text box. A person types the connector id by hand, and the save takes any string.

## What others do

The protocol gives a schema field `enum` and `enumLabels`. It adds `enumDynamic` when the full list comes from the host. ahpd's #207 follows it for a record's form. A field marked `x-ahpd-connector` is sent with the host's connectors as `enum` and `enumLabels`.

## What ahpd has today

- The plugin's `connector` option is a plain string in its `optionsSchema`. No commit gave it `x-ahpd-connector`.
- A tunnel record's `connector` field has the mark. The tunnels channel fills its choices and checks it at create and update.
- An agent record and an automation trigger have the same fill and check.
- The plugins channel sends a plugin's `optionsSchema` as the manifest gives it. It fills no choices.
- `x-ahpd/plugins/options` checks a value against the option's schema. It does not check that a marked value names a connector.
- scena's `SchemaForm` draws a field with `enum` as a picker, and labels each choice from `enumLabels`, since 0.5.18.
- ahpw draws a plugin's options with that `SchemaForm`, and uses scena 0.5.18.

## Who writes

- MayCXC's fork writes `packages/tunnel-devtunnel`. His #242 changed the sign-in, the refresh and the tunnel name, and kept the option a plain string.
- Another session writes ahpw. Its plugin options page draws the schema with scena's `SchemaForm`, and this change needs nothing there.
- `packages/server/src/pluginschannel.ts` is the host's. Nothing else writes the options check.

## The change

- The Dev Tunnels `connector` option carries `x-ahpd-connector`, as the record's field does.
- The plugins channel fills a marked option with the host's connectors, as the tunnels channel fills a record's field.
- `x-ahpd/plugins/options` refuses a marked value that names no host connector, with `connectorRefusal`.
- ahpw needs no change: its options page draws the filled option as a list.

## Open points

- Does a plugin option take only the host's connectors, as a tunnel record does, or also a person's own?
- Do other plugin options name a connector and need the mark too?
