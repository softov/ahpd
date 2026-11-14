---
title: The host sends a summary
created: 2026-11-14
refs:
  - git://805736b65 - the commit of ahpd main the facts were checked at
  - "[code://packages/sdk/src/resources/recordschannel.ts#L1-L17](../../packages/sdk/src/resources/recordschannel.ts#L1-L17) - a records channel keeps the last record it sent and sends each reader what changed on `refresh`"
  - "[code://packages/sdk/src/resources/recordschannel.ts#L95](../../packages/sdk/src/resources/recordschannel.ts#L95) - `refresh`, the one step every area calls when a row changes"
  - "[code://packages/server/src/pluginschannel.ts#L314-L338](../../packages/server/src/pluginschannel.ts#L314-L338) - a plugin row: its `state`, `loaded` and `alerts`"
  - "[code://packages/server/src/pluginschannel.ts#L422](../../packages/server/src/pluginschannel.ts#L422) - `plugin:list`, the grant that reads every plugin"
  - "[code://packages/server/src/commands/run.ts#L1829-L1832](../../packages/server/src/commands/run.ts#L1829-L1832) - `alertsChanged`, which refreshes the plugins channel when a plugin's alerts change"
  - "[code://packages/sdk/src/connectors/channel.ts#L162](../../packages/sdk/src/connectors/channel.ts#L162) - `NOTE_REFRESH_MS`, one second"
  - "[code://packages/sdk/src/connectors/channel.ts#L669-L678](../../packages/sdk/src/connectors/channel.ts#L669-L678) - `scheduleNoteRefresh`, which sends the rows a call changed at most once a second"
  - "[code://packages/sdk/src/connectors/channel.ts#L590-L598](../../packages/sdk/src/connectors/channel.ts#L590-L598) - `mayRead`, which connectors one reader sees"
  - "[code://packages/sdk/src/agents/channel.ts#L1-L12](../../packages/sdk/src/agents/channel.ts#L1-L12) - an agent row: its `state` and `alerts`, and the six states"
  - "[code://packages/sdk/src/agents/channel.ts#L743-L751](../../packages/sdk/src/agents/channel.ts#L743-L751) - `mayRead`, which agents one reader sees"
  - "[code://packages/sdk/src/tunnels/channel.ts#L181-L190](../../packages/sdk/src/tunnels/channel.ts#L181-L190) - a tunnel row: its `status`, `url` and `error`"
  - "[code://packages/sdk/src/tunnels/channel.ts#L424-L425](../../packages/sdk/src/tunnels/channel.ts#L424-L425) - `tunnel:read`, the grant that reads every tunnel"
  - "[code://packages/sdk/src/clients/channel.ts#L1-L27](../../packages/sdk/src/clients/channel.ts#L1-L27) - a client row is one open connection"
  - "[code://packages/sdk/src/clients/channel.ts#L43](../../packages/sdk/src/clients/channel.ts#L43) - `client:read`, the grant that reads every connection"
  - "[code://packages/sdk/src/host/catalogue.ts#L889-L891](../../packages/sdk/src/host/catalogue.ts#L889-L891) - a session's summary is marked dirty and sent on a debounce, as VS Code does"
  - https://github.com/microsoft/vscode/blob/1564f100807a/src/vs/platform/agentHost/common/state/protocol/channels-annotations/state.ts#L11-L31 - `AnnotationsSummary`, counts and a channel URI so badge UI renders without a subscribe to the channel
  - https://github.com/microsoft/vscode/blob/1564f100807a/src/vs/platform/agentHost/common/state/protocol/channels-root/state.ts#L32-L47 - `RootState`, with the count `activeSessions` and `_meta`
  - https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L272-L276 - VS Code's summary notifier, which marks a session and sends on a debounce
---

# The host sends a summary

Softov wants a client to show a badge on an activity bar item when something in that area needs attention.
Examples are a plugin that goes down, a connector that fails, and an agent with an alert.
A badge needs counts for the whole area, and a client that counts the rows it loaded counts the wrong set.
The host sends one summary: for each area, its total, its counts by state and its alert counts by level.
Alerts are one part of the summary, and every row keeps its own alerts.

## What others do

- AHP keeps `AnnotationsSummary` on each session summary: the annotations channel's URI and two counts.
- Its documentation says it exists so badge UI can render the counts without a subscribe to the channel.
- `RootState` carries one host count, `activeSessions`, beside the agents and the config.
- AHP has no action that updates the root's `_meta`. Only the agents, the active sessions, the terminals and the config change in place.
- VS Code's agent host marks a changed session and sends its summary on a debounce, so a burst of changes is one send.

## What ahpd has today

| Area | Channel | What a row says | Who reads it |
|---|---|---|---|
| Plugins | `x-ahpd-plugins` | `state`, `loaded` and `alerts` | `plugin:list` reads every row |
| Connectors | `x-ahpd-connectors` | `state` and `alerts` | `connector:all`, or `connector:list` with `mayRead` |
| Agents | `x-ahpd-agents` | `state` and `alerts` | `agent:all`, or `agent:list` with `mayRead` |
| Tunnels | `x-ahpd-tunnels` | `status`: `running`, `stopped` or `error` | `tunnel:read` reads every row |
| Clients | `x-ahpd-clients` | one open connection | `client:read` reads every row |

- The five areas are each a `recordsChannel`, and each calls `refresh` when one of its rows changes.
- A refresh sends the change to that channel's readers only. Nothing else in the host hears it.
- The connectors channel already sends the rows a call changed at most once a second.
- No channel or command answers a count for an area.

## Who writes

- `maycxc/plugin/54-webhook-real-senders` changes `packages/sdk/src/connectors/channel.ts`, and not its rows, its refresh or its readers.
- The brief `a-client-row-says-more-of-its-connection`, not yet committed, adds fields to a client row. A client row stays one connection, so its count does not change.

## The change

- A new channel, `x-ahpd-summary`, holds the summary. A client subscribes to it once for each host.
- The summary has one entry for each area: plugins, connectors, agents, tunnels and clients.
- Each entry has the area's channel URI, its total and its counts by state, as `AnnotationsSummary` has its channel URI and its counts.
- An entry with alerts has its alert counts by level: `error`, `warning`, `info` and `notice`.
- Each reader gets counts of the rows they may read, by the area's own grant and `mayRead`.
- An area that the reader may not read is absent from their summary, not zero.
- A records channel tells the summary after each refresh, and answers which rows one reader may read.
- The host sends the summary again at most once a second after a change, so a burst of changes is one send.
- A constant stream of changes still sends once a second, as the connectors channel does with a call's changes.
- Each send carries the whole summary, as the summary is a few numbers for each area.
- The summary is not in the root's `_meta`, because a change there sends the whole root again.

## Not in this brief

- The badges in ahpw come after this brief is built. ahpw binds an activity bar badge to a store path, as its sessions item does.
- Alerts on a tunnel row are the idea [a-tunnel-row-carries-alerts](../ideas/a-tunnel-row-carries-alerts.md).
