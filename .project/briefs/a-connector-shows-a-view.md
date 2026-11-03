---
title: A connector shows its ui
created: 2026-11-02
refs:
  - git://15f02030 - the commit of ahpd the facts were checked at
  - plans/plugin/53-a-client-sees-plugins-and-connectors/plan.md - the capability types, with `ui` reserved for a connector's component tree
  - "[code://packages/sdk/src/types/connectors.ts#L18-L27](../../packages/sdk/src/types/connectors.ts#L18-L27) - the capability type `ui`, reserved for a component tree"
  - "[code://packages/sdk/src/types/connectors.ts#L434-L465](../../packages/sdk/src/types/connectors.ts#L434-L465) - an adapter's `signIn`, `open`, `check` and `run`"
  - "[code://packages/sdk/src/connectors/channel.ts#L594-L621](../../packages/sdk/src/connectors/channel.ts#L594-L621) - `run`, which runs one `action` on one open connector after the live checks"
  - "[code://packages/sdk/src/host/tooling.ts#L547-L549](../../packages/sdk/src/host/tooling.ts#L547-L549) - the action tools, the only caller of `run` today"
  - "[code://packages/sdk/src/connectors/channel.ts#L318](../../packages/sdk/src/connectors/channel.ts#L318) - the connectors' health, kept in memory by connector id"
  - "[code://packages/sdk/src/connectors/channel.ts#L371-L375](../../packages/sdk/src/connectors/channel.ts#L371-L375) - the connector row: the record, its state and its health"
  - "[code://packages/sdk/src/types/plugin.ts#L817-L870](../../packages/sdk/src/types/plugin.ts#L817-L870) - `ViewSurface`, which is `main` only, and `PluginView`, an A2UI v0.10 surface"
  - "[code://packages/sdk/src/types/plugin.ts#L925-L933](../../packages/sdk/src/types/plugin.ts#L925-L933) - `showView` and `clearView` on the plugin host"
  - "[code://packages/sdk/src/plugins/view.ts#L18-L27](../../packages/sdk/src/plugins/view.ts#L18-L27) - the component kinds, and the limits of 200 components and 64 KiB"
  - "[code://packages/server/src/plugins.ts#L1923-L1932](../../packages/server/src/plugins.ts#L1923-L1932) - `setView` and `dropView`, which hold views in memory by plugin and surface"
  - "[code://packages/server/src/pluginschannel.ts#L87-L117](../../packages/server/src/pluginschannel.ts#L87-L117) - a view's text in a reader's locale"
  - "[code://packages/tunnel-devtunnel/src/view.ts#L39](../../packages/tunnel-devtunnel/src/view.ts#L39) - `tunnelView`, the devtunnel plugin's page"
  - "[code://docs/plugins/PLUGINS.md#L974-L990](../../docs/plugins/PLUGINS.md#L974-L990) - the plugin view and its Button, as plugin authors read it"
  - plans/plugin/20261031-1200-a-plugin-shows-its-state/plan.md - the plan that built the plugin view
  - briefs/the-host-keeps-the-tunnels.md - the operations in a channel's state, `x-ahpd/invokeOperation`, and a row's Button that names its own record
  - plans/plugin/20261102-1054-a-connector-signs-in-with-a-device-code/plan.md - the device sign-in, whose state a connector's `ui` would show
  - https://github.com/microsoft/vscode/blob/171e90619c7/src/vscode-dts/vscode.d.ts#L18051 - `AuthenticationProvider`, which has no view
  - https://github.com/microsoft/vscode/blob/171e90619c7/src/vscode-dts/vscode.d.ts#L11752 - `registerWebviewViewProvider`, a view declared in the extension's manifest
  - https://github.com/microsoft/vscode/blob/171e90619c7/src/vscode-dts/vscode.d.ts#L20519 - `McpServerDefinitionProvider`, which has no view
  - https://github.com/microsoft/vscode/blob/171e90619c7/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/stateToProgressAdapter.ts#L500-L513 - the agent host mounts an MCP App view for one tool call
---

# A connector shows its ui

Softov wants a connector to send a component tree, as a plugin does (2026-11-02: "I also think a connector maybe need to send a view like plugin").
The name is `ui`, the capability type that plan 53 reserved for it.
Softov's words in plan 53 (2026-10-21): "a connector that registers a '/' command or a custom action on ui that calls a command of its own with a form of its own".
A connector's page shows its state, its last check and its settings, and nothing that the adapter knows.
A devtunnel connector has more to say: the account it signed in as, and the tunnels it carries.
A `ui` lets the adapter's plugin say it on the connector's page, and a client draws it with no code for that adapter.

## Not in this brief

- Data bindings in a `ui`. The plugin view refuses them, and so does this one.
- A `ui` on a surface other than the connector's page.
- The sign-in step of the connector form. It stays in the client.

## What others do

- VS Code's `AuthenticationProvider` has no view. The accounts menu draws each session from its label and account.
- A VS Code extension shows a view with `registerWebviewViewProvider`. The view id is declared in the extension's manifest, not for each item at run time.
- VS Code's `McpServerDefinitionProvider` gives a server definition and no view.
- VS Code's agent host mounts an MCP App view for one tool call, from the tool's `_meta.ui.resourceUri`. The view belongs to the call, not to the server.
- None of these attaches a view to one configured item, such as one account or one server. A connector's `ui` is ahpd's own.

## What ahpd has today

The capabilities:

- A capability is a typed entry on an adapter: `receive`, `command`, `action`, `models`, and `ui`, which is reserved ([`code://packages/sdk/src/types/connectors.ts`](../../packages/sdk/src/types/connectors.ts#L18-L27)).
- An `action` has a name, a title and an `input` form. The adapter's `run` runs it with the connector it is for ([`code://packages/sdk/src/types/connectors.ts`](../../packages/sdk/src/types/connectors.ts#L434-L465)).
- The host's `run` checks that the connector is open, that the adapter declares the action, and that the reader may use the connector ([`code://packages/sdk/src/connectors/channel.ts`](../../packages/sdk/src/connectors/channel.ts#L594-L621)).
- Only the action tools call `run`, so only a model runs an action today ([`code://packages/sdk/src/host/tooling.ts`](../../packages/sdk/src/host/tooling.ts#L547-L549)). No client command runs one.
- An adapter has `signIn`, `open`, `check` and `run`, and no call that draws.

The plugin view, which a `ui` copies:

- A plugin calls `showView(view, surface?)` and `clearView(surface?)` on its host ([`code://packages/sdk/src/types/plugin.ts`](../../packages/sdk/src/types/plugin.ts#L925-L933)).
- `main`, the plugin's own page, is the only surface ([`code://packages/sdk/src/types/plugin.ts`](../../packages/sdk/src/types/plugin.ts#L817-L870)).
- A view is `{ root, components }`, an A2UI v0.10 surface. The kinds are Text, Link, Button, Card, Row, Column, List, Divider and Icon ([`code://packages/sdk/src/plugins/view.ts`](../../packages/sdk/src/plugins/view.ts#L18-L27)).
- A view has at most 200 components and 64 KiB of JSON, and only literal props.
- The server holds views in memory, by plugin and then by surface ([`code://packages/server/src/plugins.ts`](../../packages/server/src/plugins.ts#L1923-L1932)).
- A Text's `text` and a Link's `label` come in the reader's locale from the plugin's catalog ([`code://packages/server/src/pluginschannel.ts`](../../packages/server/src/pluginschannel.ts#L87-L117)).
- A Button's `action` is `{ event: { name, context? } }`. `name` is an `x-` method that the same plugin registered, and `context` is the request's params ([`code://docs/plugins/PLUGINS.md`](../../docs/plugins/PLUGINS.md#L974-L990)).
- ahpw sends only the Button's `context` as params. The page's path is not sent.
- The devtunnel plugin shows the state of its tunnel on its own page, and polls every 30 seconds ([`code://packages/tunnel-devtunnel/src/view.ts`](../../packages/tunnel-devtunnel/src/view.ts#L39)).

The connector row:

- The connector row is the record, its state and its health ([`code://packages/sdk/src/connectors/channel.ts`](../../packages/sdk/src/connectors/channel.ts#L371-L375)).
- Health is kept in memory by connector id, as the views are ([`code://packages/sdk/src/connectors/channel.ts`](../../packages/sdk/src/connectors/channel.ts#L318)).

## Who writes

| Writer | Files it changes | What the change does to it |
| --- | --- | --- |
| Plan `20261102-1122-the-host-keeps-the-tunnels`, not built | The devtunnel plugin's `view.ts` and `plugin.ts`, and the shared core of operations | Its tunnels belong to a connector. A connector's `ui` is a place to list them. The connector operations use its `x-ahpd/invokeOperation`, so this change comes after that plan. |
| [a-person-acts-from-a-plugin-page.md](a-person-acts-from-a-plugin-page.md) | The devtunnel plugin's page and its actions | Its devtunnel actions are Buttons on the plugin's page. Some of them act on one account, which is one connector. |
| MayCXC, `plugin/54-webhook-real-senders`, not merged | `connectors/channel.ts`: `refs()` and automation fields. `types/connectors.ts`, `types/plugin.ts` | Other parts of the files. No conflict expected at the row. |

## Answers

| What | Source |
| --- | --- |
| The connector's component tree is the capability type `ui`, not a new "view" | Softov, 2026-11-02: "I mean ui was the real name..." |
| `open` hands the adapter a handle that sets and clears that connector's `ui`. The handle names only that connector | Softov, 2026-11-02, chose "A handle from open" |
| An adapter that draws declares a `ui` capability, and the connector row carries the tree as `ui` | (defaulted: a capability is declared and shown, as plan 53 says) |
| An adapter's `action` capabilities are operations in the state of `x-ahpd-connectors://`, as a tunnel kind's operations are in [the-host-keeps-the-tunnels.md](the-host-keeps-the-tunnels.md) | Softov, 2026-11-02: "think like a connector action for tunnels, the id the tunnel id right?", then chose "Record it" |
| A `ui` Button calls `x-ahpd/invokeOperation` with that channel, the operation id and `target: { id: <connector id> }`. The host checks the operation, the grant and the connector, and calls the adapter's `run` with that connector | Softov, 2026-11-02, chose "Record it" |
| The plugin writes the connector id in `target` as a literal, from its `open` handle. Once a view has data, the id is `{ path: 'id' }`, as in the tunnel row | Softov, 2026-11-02, chose "Record it" |
| The first `ui` of the devtunnel adapter shows what the adapter holds: the account and the last refresh. It needs no poll. The tunnels come with plan 1122 | (defaulted: the adapter knows both without a call to the service) |

## The change

- An adapter that draws declares a `ui` capability, so a client knows the connector's page has one.
- The adapter's plugin sets the `ui` of one connector through the handle that `open` gives, and takes it away.
- A `ui` has the shape, the kinds and the limits of a plugin view, and the same check.
- The host holds the `ui` in memory by connector id, as it holds health.
- The connector row carries it as `ui`, so a reader of the connector reads its `ui`.
- Closing or removing the connector takes the `ui` away, and so does an unload of the plugin.
- An adapter's `action` capabilities are operations in the state of `x-ahpd-connectors://`, each scoped to one connector.
- A Button in a `ui` calls `x-ahpd/invokeOperation` with the connector as its `target`. The host runs the adapter's `run` after the checks that `run` makes today and the operation's grant.
- The text comes in the reader's locale from the plugin's catalog, as a plugin view's text does.
- A client draws the `ui` on the connector's page, from the row, with no code for the adapter.
- The devtunnel adapter is the first user.

## Open points

None. The operations need the shared core of plan `20261102-1122-the-host-keeps-the-tunnels`.
