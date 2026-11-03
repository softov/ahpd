---
title: A connector shows a view
created: 2026-11-02
refs:
  - git://60fa2ccd - the commit of ahpd the facts were checked at
  - "[code://packages/sdk/src/types/plugin.ts#L808-L865](../../packages/sdk/src/types/plugin.ts#L808-L865) - `ViewSurface`, which is `main` only, and `PluginView`, an A2UI v0.10 surface"
  - "[code://packages/sdk/src/types/plugin.ts#L911-L932](../../packages/sdk/src/types/plugin.ts#L911-L932) - `showView` and `clearView` on the plugin host"
  - "[code://packages/sdk/src/plugins/view.ts#L17-L27](../../packages/sdk/src/plugins/view.ts#L17-L27) - the component kinds, and the limits of 200 components and 64 KiB"
  - "[code://packages/server/src/plugins.ts#L1902-L1915](../../packages/server/src/plugins.ts#L1902-L1915) - `setView` and `dropView`, which hold views in memory by plugin and surface"
  - "[code://packages/server/src/pluginschannel.ts#L86-L117](../../packages/server/src/pluginschannel.ts#L86-L117) - a view's text in a reader's locale"
  - "[code://packages/server/src/pluginschannel.ts#L290-L296](../../packages/server/src/pluginschannel.ts#L290-L296) - the plugin row carries `views` only while the plugin runs"
  - "[code://packages/sdk/src/connectors/channel.ts#L272](../../packages/sdk/src/connectors/channel.ts#L272) - the connectors' health, kept in memory by connector id"
  - "[code://packages/sdk/src/connectors/channel.ts#L312-L318](../../packages/sdk/src/connectors/channel.ts#L312-L318) - the connector row: the record, its state and its health"
  - "[code://packages/sdk/src/types/connectors.ts#L18-L27](../../packages/sdk/src/types/connectors.ts#L18-L27) - the capability type `ui`, reserved for a component tree"
  - "[code://packages/sdk/src/types/connectors.ts#L343-L360](../../packages/sdk/src/types/connectors.ts#L343-L360) - an adapter's `signIn`, `open` and `check`"
  - "[code://packages/tunnel-devtunnel/src/view.ts#L39](../../packages/tunnel-devtunnel/src/view.ts#L39) - `tunnelView`, the devtunnel plugin's page"
  - "[code://docs/plugins/PLUGINS.md#L877-L895](../../docs/plugins/PLUGINS.md#L877-L895) - the plugin view, as plugin authors read it"
  - plans/plugin/20261031-1200-a-plugin-shows-its-state/plan.md - the plan that built the plugin view
  - plans/plugin/20261102-1054-a-connector-signs-in-with-a-device-code/plan.md - the device sign-in, whose state a connector view would show
  - https://github.com/microsoft/vscode/blob/171e90619c7/src/vscode-dts/vscode.d.ts#L18051 - `AuthenticationProvider`, which has no view
  - https://github.com/microsoft/vscode/blob/171e90619c7/src/vscode-dts/vscode.d.ts#L11752 - `registerWebviewViewProvider`, a view declared in the extension's manifest
  - https://github.com/microsoft/vscode/blob/171e90619c7/src/vscode-dts/vscode.d.ts#L20519 - `McpServerDefinitionProvider`, which has no view
  - https://github.com/microsoft/vscode/blob/171e90619c7/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/stateToProgressAdapter.ts#L500-L513 - the agent host mounts an MCP App view for one tool call
---

# A connector shows a view

Softov wants a connector to send a view, as a plugin does (2026-11-02: "I also think a connector maybe need to send a view like plugin").
A connector's page shows its state, its last check and its settings, and nothing that the adapter knows.
A devtunnel connector has more to say: the account it signed in as, and the tunnels it carries.
A view lets the adapter's plugin say it on the connector's page, and a client draws it with no code for that adapter.

## Not in this brief

- Data bindings in a view. The plugin view refuses them, and so does this one.
- A view on a surface other than the connector's page.
- The sign-in step of the connector form. It stays in the client.

## What others do

- VS Code's `AuthenticationProvider` has no view. The accounts menu draws each session from its label and account.
- A VS Code extension shows a view with `registerWebviewViewProvider`. The view id is declared in the extension's manifest, not for each item at run time.
- VS Code's `McpServerDefinitionProvider` gives a server definition and no view.
- VS Code's agent host mounts an MCP App view for one tool call, from the tool's `_meta.ui.resourceUri`. The view belongs to the call, not to the server.
- None of these attaches a view to one configured item, such as one account or one server. A connector view is ahpd's own.

## What ahpd has today

- A plugin calls `showView(view, surface?)` and `clearView(surface?)` on its host ([`code://packages/sdk/src/types/plugin.ts`](../../packages/sdk/src/types/plugin.ts#L911-L932)).
- `main`, the plugin's own page, is the only surface ([`code://packages/sdk/src/types/plugin.ts`](../../packages/sdk/src/types/plugin.ts#L808-L865)).
- A view is `{ root, components }`, an A2UI v0.10 surface. The kinds are Text, Link, Button, Card, Row, Column, List, Divider and Icon ([`code://packages/sdk/src/plugins/view.ts`](../../packages/sdk/src/plugins/view.ts#L17-L27)).
- A view has at most 200 components and 64 KiB of JSON, and only literal props.
- The server holds views in memory, by plugin and then by surface ([`code://packages/server/src/plugins.ts`](../../packages/server/src/plugins.ts#L1902-L1915)).
- The plugin row carries `views` only while the plugin runs ([`code://packages/server/src/pluginschannel.ts`](../../packages/server/src/pluginschannel.ts#L290-L296)).
- A Text's `text` and a Link's `label` come in the reader's locale from the plugin's catalog ([`code://packages/server/src/pluginschannel.ts`](../../packages/server/src/pluginschannel.ts#L86-L117)).
- A Button calls an `x-` method that the same plugin registered, under the grant of the person who clicks ([`code://docs/plugins/PLUGINS.md`](../../docs/plugins/PLUGINS.md#L877-L895)).
- The devtunnel plugin shows the state of its tunnel on its own page, and polls every 30 seconds ([`code://packages/tunnel-devtunnel/src/view.ts`](../../packages/tunnel-devtunnel/src/view.ts#L39)).
- The connector row is the record, its state and its health ([`code://packages/sdk/src/connectors/channel.ts`](../../packages/sdk/src/connectors/channel.ts#L314-L318)).
- Health is kept in memory by connector id, as the views are ([`code://packages/sdk/src/connectors/channel.ts`](../../packages/sdk/src/connectors/channel.ts#L272)).
- The capability type `ui` is reserved for a component tree that a later plan adds ([`code://packages/sdk/src/types/connectors.ts`](../../packages/sdk/src/types/connectors.ts#L18-L27)).
- An adapter has `signIn`, `open` and `check`, and no call that draws ([`code://packages/sdk/src/types/connectors.ts`](../../packages/sdk/src/types/connectors.ts#L343-L360)).
- No idea, brief or plan names a connector view.

## Who writes

| Writer | Files it changes | What the change does to it |
| --- | --- | --- |
| Plan `20261102-1054-a-connector-signs-in-with-a-device-code`, branch `build/agents/b6d26e50`, not merged | `connectors/channel.ts`: the state `unauthorized`, and `ownPlugin`. `connectors/adapters.ts`, the devtunnel adapter | The view uses `ownPlugin`, so only the adapter's plugin sets it. Plan after it merges. |
| Plan `20261102-1122-the-host-keeps-the-tunnels`, not built | The devtunnel plugin's `view.ts` and `plugin.ts` | Its tunnels belong to a connector. A connector view is a place to list them. |
| MayCXC, `plugin/54-webhook-real-senders`, not merged | `connectors/channel.ts`: `refs()` and automation fields. `types/connectors.ts`, `types/plugin.ts` | Other parts of the files. No conflict expected at the row. |
| MayCXC, `union-2026-10-30-0c75e15c` and `union-2026-10-30-69c27900`, not merged | `connectors/channel.ts`, at the head of the file | Old union snapshots. Not checked line by line. |

## The change

- The adapter's own plugin sets a view on one of its connectors, and takes it away.
- The view has the shape, the kinds and the limits of a plugin view, and the same check.
- The host holds the view in memory by connector id, as it holds health.
- The connector row carries the view as `view`, so a reader of the connector reads its view.
- Closing or removing the connector takes the view away, and so does an unload of the plugin.
- A Button calls an `x-` method of the adapter's plugin, under the grant of the person who clicks.
- The text comes in the reader's locale from the plugin's catalog, as a plugin view's text does.
- A client draws the view on the connector's page, from the row, with no code for the adapter.
- The devtunnel adapter is the first user: the account, the last refresh, and later the tunnels.

## Open points

1. **The call.** The plugin host can take `showConnectorView(id, view)` and `clearConnectorView(id)`, or `open` can hand the adapter a handle with `showView`. The handle cannot name another plugin's connector.
2. **A Button's connector.** A Button names a method and its params. The host can add the connector id to the params, or the plugin can write it in the view.
3. **The capability type `ui`.** A connector view can replace it, or the type stays reserved.
4. **The poll.** The devtunnel plugin polls every 30 seconds for its page. One poll for each connector costs one request each time. Not checked: whether the Dev Tunnels SDK of the tunnels plan pushes changes.
