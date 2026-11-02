---
title: The host keeps the tunnels
created: 2026-11-02
refs:
  - git://0e6fff13 - the commit of ahpd the facts were checked at, on the `plugin/canvas-example` branch
  - git://2ed435c - the commit of ahpw the facts were checked at
  - git://v0.5.16 - the scena version ahpw uses, where the facts on scena were checked
  - git://171e90619c7 - the commit of VS Code the facts were checked at
  - git://ff7d6a1c7b4 - the commit of the Agent Host Protocol the facts were checked at
  - "[code://packages/sdk/src/types/plugin.ts#L850-L856](../../packages/sdk/src/types/plugin.ts#L850-L856) - a view is scena's `A2uiCreateSurface` without `dataModel`, sent whole on each change"
  - "[code://packages/sdk/src/types/plugin.ts#L913-L926](../../packages/sdk/src/types/plugin.ts#L913-L926) - `showView`: a view on `main` replaces the one before it"
  - "[code://packages/sdk/src/plugins/view.ts#L34-L44](../../packages/sdk/src/plugins/view.ts#L34-L44) - `literalOf` refuses a `{ path }` binding, the one place that changes when bindings arrive"
  - "[code://packages/server/src/pluginschannel.ts#L325-L327](../../packages/server/src/pluginschannel.ts#L325-L327) - a plugin's view rides its row on the plugins channel"
  - "[code://packages/tunnel-devtunnel/src/plugin.ts#L149-L235](../../packages/tunnel-devtunnel/src/plugin.ts#L149-L235) - the one tunnel devtunnel holds, made at `listening`"
  - "[code://packages/tunnel-devtunnel/src/devtunnel.ts#L209-L224](../../packages/tunnel-devtunnel/src/devtunnel.ts#L209-L224) - `prepare`, which adds the one port and its anonymous access"
  - "[code://packages/tunnel-devtunnel/src/view.ts#L38-L66](../../packages/tunnel-devtunnel/src/view.ts#L38-L66) - devtunnel's page: state only, no Button"
  - "[code://packages/server/src/commands/run.ts#L140-L152](../../packages/server/src/commands/run.ts#L140-L152) - `announcedNames`, the URLs read out of `say` lines"
  - "[code://packages/server/src/commands/run.ts#L1667](../../packages/server/src/commands/run.ts#L1667) - announced names reach the routes' `Host` check"
  - "[code://packages/sdk/src/types/plugin.ts#L1194-L1200](../../packages/sdk/src/types/plugin.ts#L1194-L1200) - `registerMethod`, one `x-` command by name"
  - "[code://packages/sdk/src/types/plugin.ts#L522-L546](../../packages/sdk/src/types/plugin.ts#L522-L546) - `PluginMethod`: a grant, a handler and a title, with no icon and no input schema"
  - "[code://packages/sdk/src/host/root.ts#L548-L566](../../packages/sdk/src/host/root.ts#L548-L566) - `advertisedMethods`, what a client hears of each method"
  - "[code://packages/sdk/src/types/plugin.ts#L1176-L1185](../../packages/sdk/src/types/plugin.ts#L1176-L1185) - `registerResourceProvider`: two plugins cannot serve one scheme"
  - "[code://packages/sdk/src/types/connectors.ts#L299-L318](../../packages/sdk/src/types/connectors.ts#L299-L318) - `Adapter`: a name, a title, a description, a form schema and icons"
  - "[code://packages/sdk/src/types/agents.ts#L105](../../packages/sdk/src/types/agents.ts#L105) - `Engine`, the second kind a plugin offers, with the same shape"
  - "[code://packages/sdk/src/types/plugin.ts#L1435-L1454](../../packages/sdk/src/types/plugin.ts#L1435-L1454) - `registerAdapter` and `registerEngine`: a name is registered once"
  - "[code://packages/sdk/src/plugins/plugins.ts#L1777-L1797](../../packages/sdk/src/plugins/plugins.ts#L1777-L1797) - the two calls check the name against `contracts` and keep what the plugin gave"
  - "[code://packages/sdk/src/plugins/plugins.ts#L1124](../../packages/sdk/src/plugins/plugins.ts#L1124) - nothing is registered after `apply` returns"
  - "[code://packages/webhook/src/adapter.ts#L56](../../packages/webhook/src/adapter.ts#L56) - a form field marked `secret: true`, which the vault keeps"
  - "[code://packages/sdk/src/host/resourcemethods.ts#L280-L300](../../packages/sdk/src/host/resourcemethods.ts#L280-L300) - ahpd serves `invokeChangesetOperation` from the operations it offers now"
  - https://github.com/softov/scena/blob/v0.5.16/packages/scena/src/core/converters/a2ui-v0.10.ts#L27-L43 - `dataModel` on a surface, and `children` as `{ path, componentId }`, one row for each item
  - https://github.com/softov/scena/blob/v0.5.16/packages/scena/src/core/resolve/dynamic-resolver.ts#L162-L190 - a Button's `context` resolves `{ path }` against the row's data
  - https://github.com/softov/scena/blob/v0.5.16/packages/scena/src/runtime/surface-bridge.ts#L115-L141 - `surface:update` with `path` and `value` sets one path of the data
  - https://github.com/softov/ahpw/blob/2ed435c/src/resources/plugins/PluginViewPanel.tsx#L26-L28 - ahpw draws a view with scena's `ViewMount`, and gives it no data
  - https://github.com/softov/ahpw/blob/2ed435c/src/resources/plugins/view.ts#L6 - the component kinds ahpw draws on a plugin's page
  - https://github.com/microsoft/vscode/blob/171e90619c7/src/vs/platform/tunnel/common/tunnel.ts#L126-L144 - `ITunnelService`, the list of open tunnels and one provider
  - https://github.com/microsoft/vscode/blob/171e90619c7/src/vs/workbench/contrib/remote/browser/tunnelView.ts#L1112-L1116 - the Ports view's "Forward a Port" action
  - https://github.com/microsoft/vscode/blob/171e90619c7/src/vscode-dts/vscode.proposed.resolvers.d.ts#L45 - `registerTunnelProvider`, how an extension gives VS Code tunnels
  - https://code.visualstudio.com/api/references/contribution-points#contributes.commands - a VS Code command: an id, a title and an icon, run from many places
  - https://modelcontextprotocol.io/specification/2025-06-18/server/tools - an MCP tool declares the JSON Schema of its input
  - https://github.com/microsoft/agent-host-protocol/blob/ff7d6a1c7b4/types/channels-changeset/state.ts#L259-L298 - `ChangesetOperation`: an id, a label, an icon, scopes, a confirmation, a status and an error
  - https://github.com/microsoft/agent-host-protocol/blob/ff7d6a1c7b4/types/channels-changeset/state.ts#L148 - a changeset's state lists its `operations`
  - https://github.com/microsoft/agent-host-protocol/blob/ff7d6a1c7b4/types/channels-changeset/commands.ts#L58-L88 - `invokeChangesetOperation`: one command, with the channel, the operation and a target
  - https://github.com/softov/scena/blob/v0.5.16/packages/scena/src/core/resolve/path-resolver.ts#L1-L35 - `$/<namespace>/...` is absolute, `/...` is relative to the data context, any other path is refused
  - https://github.com/softov/scena/blob/v0.5.16/packages/scena/src/core/converters/a2ui-v0.10.ts#L210-L215 - an A2UI path such as `url` becomes `/url`, which is relative
  - https://github.com/softov/scena/blob/v0.5.16/packages/scena/src/sdk/reactive-store.ts#L27-L36 - `registerDataProvider`, a namespace of the store with its `load` and `unload`
  - https://github.com/softov/ahpw/blob/2ed435c/src/bridges/data.ts#L780-L783 - ahpw's `ahp` namespace, loaded at start
  - https://github.com/softov/ahpw/blob/2ed435c/src/bridges/data.ts#L22 - a host's data at `$/ahp/hosts/<host>`
  - https://github.com/softov/ahpw/blob/2ed435c/src/bridges/data.ts#L80 - a followed channel's state at `$/ahp/hosts/<host>/channels/<uri>`
  - https://github.com/softov/ahpw/blob/2ed435c/src/bridges/data.ts#L241-L246 - `follow`, one subscription that pages share while they show the channel
  - https://github.com/softov/ahpw/blob/2ed435c/src/bridges/plugins.ts#L160-L162 - a Button's method is a request on the host's connection
  - "[code://packages/server/src/plugins.ts#L1923-L1926](../../packages/server/src/plugins.ts#L1923-L1926) - `setView` keeps the view and says the views changed"
  - "[code://packages/server/src/commands/run.ts#L1476-L1478](../../packages/server/src/commands/run.ts#L1476-L1478) - a views change refreshes the whole plugins channel"
  - "[code://packages/sdk/src/resources/recordschannel.ts#L113-L125](../../packages/sdk/src/resources/recordschannel.ts#L113-L125) - `owner` is the one query a records channel takes"
  - "[code://packages/sdk/src/types/plugin.ts#L1186-L1193](../../packages/sdk/src/types/plugin.ts#L1186-L1193) - `registerChannel`: a plugin's channel scheme starts with `x-`"
  - "[code://packages/sdk/src/types/plugin.ts#L1474-L1483](../../packages/sdk/src/types/plugin.ts#L1474-L1483) - `contracts`: the names a plugin may register, by kind, as strings"
  - "[code://packages/sdk/src/host/channels.ts#L59-L61](../../packages/sdk/src/host/channels.ts#L59-L61) - `methodIn`, the served `x-` command a request names"
  - "[code://packages/sdk/src/host/admission.ts#L17-L18](../../packages/sdk/src/host/admission.ts#L17-L18) - the host finds the command before it checks its grant"
  - https://github.com/microsoft/agent-host-protocol/issues/537 - Softov's proposal of resource kinds, each with a schema and operations
  - https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/cli-commands - many ports on one tunnel, a URL and access for each port, read 2026-11-02
  - file:///github/ahpd/.project/briefs/a-computer-kind-comes-from-any-plugin.md - the same model for computers
  - file:///github/ahpd/.project/briefs/a-person-acts-from-a-plugin-page.md - the devtunnel actions and the canvas URL, which read this list
  - file:///github/ahpd/.project/briefs/a-cloudflare-tunnel-publishes-the-daemon.md - a second tunnel plugin, which adds a kind to this list
  - file:///github/ahpd/.project/briefs/an-agent-makes-a-canvas.md - the example canvas, the first user of a forwarded port
---

# The host keeps the tunnels

The goal has five parts.
The host keeps a list of tunnels: each tunnel, its kind, and where it is in use.
The host owns the operations on the list, and any plugin adds a kind of tunnel, such as devtunnel or ssh.
Each kind asks for its own input when a person creates a tunnel of it.
Each tunnel plugin lists its own tunnels on its `main` view, from its own data, and a client reads the data of one plugin only.
A view can also show another plugin's data, such as a `crm` plugin's clients, which the client reads as the person.
Softov wants this before the canvas example and the devtunnel actions, because both need a tunnel's URL.

## What others do

VS Code keeps the tunnels in one service, and extensions provide them.

- `ITunnelService` holds `tunnels`, the open tunnels, and raises `onTunnelOpened` ([tunnel.ts](https://github.com/microsoft/vscode/blob/171e90619c7/src/vs/platform/tunnel/common/tunnel.ts#L126-L144)).
- One provider makes the tunnels. An extension gives it with `registerTunnelProvider`, a proposed API ([resolvers.d.ts](https://github.com/microsoft/vscode/blob/171e90619c7/src/vscode-dts/vscode.proposed.resolvers.d.ts#L45)).
- The Ports view lists the tunnels and has a "Forward a Port" action ([tunnelView.ts](https://github.com/microsoft/vscode/blob/171e90619c7/src/vs/workbench/contrib/remote/browser/tunnelView.ts#L1112-L1116)).

The Agent Host Protocol puts a changeset's operations in the channel's state, and one command invokes them. The tunnel operations follow this model.

- A changeset's state lists `operations` ([state.ts](https://github.com/microsoft/agent-host-protocol/blob/ff7d6a1c7b4/types/channels-changeset/state.ts#L148)).
- An operation has an `id`, a `label`, a `description`, an `icon`, a `group`, `scopes` and an optional `confirmation` ([state.ts](https://github.com/microsoft/agent-host-protocol/blob/ff7d6a1c7b4/types/channels-changeset/state.ts#L259-L298)).
- The server keeps each operation's `status`, `idle`, `running` or `error`, and its `error`, so every subscriber sees a call in progress.
- The scopes are `changeset`, `resource` and `range`. A call for a `resource` or a `range` carries a `target`.
- `invokeChangesetOperation` takes the `channel`, the `operationId` and the `target` ([commands.ts](https://github.com/microsoft/agent-host-protocol/blob/ff7d6a1c7b4/types/channels-changeset/commands.ts#L58-L88)). The server refuses an operation that its state does not list now.
- An operation takes no input other than its target.

VS Code declares commands, and a person runs one from many places ([contributes.commands](https://code.visualstudio.com/api/references/contribution-points#contributes.commands)):

- An extension declares each command with an id, a title and an icon.
- The command palette, a menu and a view's title bar call the same command.
- A command asks for its input in its own code, such as with `showInputBox`.

An MCP server declares each tool with a JSON Schema of its input, so a client knows the params before it calls ([tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)).

A2UI, as scena 0.5.16 draws it, separates a surface's components from its data:

- A surface carries a `dataModel` beside its components ([a2ui-v0.10.ts](https://github.com/softov/scena/blob/v0.5.16/packages/scena/src/core/converters/a2ui-v0.10.ts#L27-L43)).
- A prop reads the data with `{ path }`.
- `children` as `{ path, componentId }` draws one copy of a component for each item of a list.
- A Button's `context` resolves `{ path }` against the data of its own row ([dynamic-resolver.ts](https://github.com/softov/scena/blob/v0.5.16/packages/scena/src/core/resolve/dynamic-resolver.ts#L162-L190)).
- An update with `path` and `value` sets one path of the data, and the components that read it draw again ([surface-bridge.ts](https://github.com/softov/scena/blob/v0.5.16/packages/scena/src/runtime/surface-bridge.ts#L115-L141)).

scena's store reads a path in one of two forms ([path-resolver.ts](https://github.com/softov/scena/blob/v0.5.16/packages/scena/src/core/resolve/path-resolver.ts#L1-L35)):

| Path | What scena reads |
| --- | --- |
| `$/crm/clients` | Absolute. `crm` is a namespace of the store. It reads the same inside a list row and outside it |
| `/$crm/clients` | Relative to the data context. `$crm` is only a key, and `$` means nothing to scena |
| `$crm/clients` | Refused: a path starts with `$/` or `/`. In an A2UI view the converter makes it `/$crm/clients`, a relative path ([a2ui-v0.10.ts](https://github.com/softov/scena/blob/v0.5.16/packages/scena/src/core/converters/a2ui-v0.10.ts#L210-L215)) |

- A2UI's `url` becomes `/url`, so `url` and `/tunnels` are both relative. Inside a list row, both read the row's own item.
- `registerDataProvider` adds a namespace with a `load` and an `unload` ([reactive-store.ts](https://github.com/softov/scena/blob/v0.5.16/packages/scena/src/sdk/reactive-store.ts#L27-L36)). A `lazy` namespace loads when a view first reads it.

Dev Tunnels holds many ports on one tunnel ([cli-commands](https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/cli-commands)):

- `devtunnel port create -p <port>` adds a port, and `port delete` removes it.
- Each port has its own URL, `https://<id>-<port>.<region>.devtunnels.ms/`.
- Anonymous access is set for each port.

## What ahpd has today

A plugin's view:

- A view is scena's `A2uiCreateSurface` without `dataModel` ([`code://packages/sdk/src/types/plugin.ts`](../../packages/sdk/src/types/plugin.ts#L850-L856)).
- A plugin sends the whole view on each change, and a view on `main` replaces the one before it ([`code://packages/sdk/src/types/plugin.ts`](../../packages/sdk/src/types/plugin.ts#L913-L926)).
- `literalOf` refuses a `{ path }` binding. Its doc names it as the one place that changes when bindings arrive ([`code://packages/sdk/src/plugins/view.ts`](../../packages/sdk/src/plugins/view.ts#L34-L44)).
- The view rides the plugin's row on the plugins channel ([`code://packages/server/src/pluginschannel.ts`](../../packages/server/src/pluginschannel.ts#L325-L327)).

How a view reaches a client:

- A client subscribes to `x-ahpd-plugins://`, the list of plugins. A client with no subscription receives nothing.
- `showView` keeps the view and says that the views changed ([`code://packages/server/src/plugins.ts`](../../packages/server/src/plugins.ts#L1923-L1926)). The daemon then refreshes the whole channel ([`code://packages/server/src/commands/run.ts`](../../packages/server/src/commands/run.ts#L1476-L1478)).
- The refresh sends `x-ahpd-plugins/changed` with the whole row, every view in it. It goes to each subscriber that may read the row, also when that client does not show the plugin's page.
- `owner` is the one query a records channel takes ([`code://packages/sdk/src/resources/recordschannel.ts`](../../packages/sdk/src/resources/recordschannel.ts#L113-L125)). No client can subscribe to one plugin's row.

A kind that a plugin offers:

- `registerAdapter` offers a kind of connector, and `registerEngine` a kind of agent ([`code://packages/sdk/src/types/plugin.ts`](../../packages/sdk/src/types/plugin.ts#L1435-L1454)).
- Each has a slug `name`, a `title`, a `description`, a JSON Schema `schema` for the form and `icons` ([`code://packages/sdk/src/types/connectors.ts`](../../packages/sdk/src/types/connectors.ts#L299-L318), [`code://packages/sdk/src/types/agents.ts`](../../packages/sdk/src/types/agents.ts#L105)).
- A form field marked `secret: true` is kept in the vault, and a record keeps only a reference ([`code://packages/webhook/src/adapter.ts`](../../packages/webhook/src/adapter.ts#L56)).
- The manifest lists only the names, in `contracts.adapters` and `contracts.engines`. The call checks the name against that list ([`code://packages/sdk/src/plugins/plugins.ts`](../../packages/sdk/src/plugins/plugins.ts#L1777-L1797)).
- A plugin registers only during `apply`. A call after `apply` returns is refused ([`code://packages/sdk/src/plugins/plugins.ts`](../../packages/sdk/src/plugins/plugins.ts#L1124)).

Operations in a channel's state:

- ahpd serves `invokeChangesetOperation` from the `changes` port ([`code://packages/sdk/src/host/resourcemethods.ts`](../../packages/sdk/src/host/resourcemethods.ts#L280-L300)).
- It refuses an operation the changeset does not offer now, and a target of a scope the operation does not take.

A plugin's methods:

- The manifest lists the method names a plugin may register, in `contracts.methods`, as strings ([`code://packages/sdk/src/types/plugin.ts`](../../packages/sdk/src/types/plugin.ts#L1474-L1483)). A name it does not list is refused. devtunnel's `contracts` is `{}`.
- `registerMethod` serves one `x-` command by name ([`code://packages/sdk/src/types/plugin.ts`](../../packages/sdk/src/types/plugin.ts#L1194-L1200)).
- A method declares a grant, a handler, and a title and description. It declares no icon and no input schema ([`code://packages/sdk/src/types/plugin.ts`](../../packages/sdk/src/types/plugin.ts#L522-L546)).
- The host advertises each method in `_meta['ahpd.methods']`, with its name, title, description and grant ([`code://packages/sdk/src/host/root.ts`](../../packages/sdk/src/host/root.ts#L548-L566)).

Where a call goes:

- A client sends a call as a JSON-RPC request on its own connection to the host, with the method name, such as `x-ahpd/computers/create` ([plugins.ts](https://github.com/softov/ahpw/blob/2ed435c/src/bridges/plugins.ts#L160-L162)).
- The host finds the served command by its name ([`code://packages/sdk/src/host/channels.ts`](../../packages/sdk/src/host/channels.ts#L59-L61)) and checks the caller's grant ([`code://packages/sdk/src/host/admission.ts`](../../packages/sdk/src/host/admission.ts#L17-L18)).
- The handler runs in the daemon, and its answer goes to the caller alone. A call is not a channel action, so no other client receives it.
- Other clients see only the data change that the handler sends.

A plugin's channel:

- `registerChannel` serves one scheme as a channel that a client subscribes to ([`code://packages/sdk/src/types/plugin.ts`](../../packages/sdk/src/types/plugin.ts#L1186-L1193)).
- The scheme starts with `x-`, so a `crm` plugin serves `x-crm://`, not `crm://`. Two plugins cannot serve one scheme.

ahpw:

- It draws a view with scena's `ViewMount`, and gives it no data context ([PluginViewPanel.tsx](https://github.com/softov/ahpw/blob/2ed435c/src/resources/plugins/PluginViewPanel.tsx#L26-L28)).
- It draws Text, Link, Button, Card, Row, Column, List, Divider and Icon ([view.ts](https://github.com/softov/ahpw/blob/2ed435c/src/resources/plugins/view.ts#L6)). It has no field a person types into.
- It registers the `ahp` namespace in scena's store, loaded at start ([data.ts](https://github.com/softov/ahpw/blob/2ed435c/src/bridges/data.ts#L780-L783)). A host's data is at `$/ahp/hosts/<host>` ([data.ts](https://github.com/softov/ahpw/blob/2ed435c/src/bridges/data.ts#L22)).
- `follow(uri, reducer)` keeps a channel's state at `$/ahp/hosts/<host>/channels/<uri>` ([data.ts](https://github.com/softov/ahpw/blob/2ed435c/src/bridges/data.ts#L80)). Pages that show one channel share one subscription, and it ends a moment after the last page lets go ([data.ts](https://github.com/softov/ahpw/blob/2ed435c/src/bridges/data.ts#L241-L246)).

The tunnels:

- devtunnel holds one tunnel with one port, the daemon's ([`code://packages/tunnel-devtunnel/src/plugin.ts`](../../packages/tunnel-devtunnel/src/plugin.ts#L149-L235), [`code://packages/tunnel-devtunnel/src/devtunnel.ts`](../../packages/tunnel-devtunnel/src/devtunnel.ts#L209-L224)).
- Its view shows state and has no Button ([`code://packages/tunnel-devtunnel/src/view.ts`](../../packages/tunnel-devtunnel/src/view.ts#L38-L66)).
- A plugin gives an address only in a `say` line during `listening`. `announcedNames` reads the URLs out of those lines ([`code://packages/server/src/commands/run.ts`](../../packages/server/src/commands/run.ts#L140-L152)).
- Only the routes' `Host` check reads those names ([`code://packages/server/src/commands/run.ts`](../../packages/server/src/commands/run.ts#L1667)).
- No list of tunnels exists, and no plugin can read the address another plugin gave.

## Who writes

| Writer | Files | What the change does to it |
| --- | --- | --- |
| The `plugin/canvas-example` branch | `examples/canvas/` | The example asks the list for a forwarded port, and reads its URL from the list |
| [a-person-acts-from-a-plugin-page.md](a-person-acts-from-a-plugin-page.md) | devtunnel actions, the canvas URL | This brief takes the host's list. The devtunnel actions become operations of the devtunnel kind |
| [a-cloudflare-tunnel-publishes-the-daemon.md](a-cloudflare-tunnel-publishes-the-daemon.md) | A new `@ahpd/cloudflare` package | The plugin registers a second kind, and lists its tunnels on its own view |
| [a-computer-kind-comes-from-any-plugin.md](a-computer-kind-comes-from-any-plugin.md) | `packages/computer/`, the server package | The same model for computers. The two share the operations in the state and the kind registration |
| ahpw | `src/resources/plugins/`, `src/bridges/` | It follows a plugin's row while its page shows, puts the plugin's data and each source in scena's store, and applies a change to one path. It draws an operation from a channel's state, and a form from its `input` |
| scena | None, unless a page must register a namespace while it shows | 0.5.16 already draws a data model, list items, `$/` namespaces and `{ path }` in a Button's `context` |
| `release/prerelease-channel` worktree | Release files | No overlap |
| MayCXC's `union`, ten host plans from 2026-11-02 | Merged in PR #186 | No overlap left |
| MayCXC's `plugin/54-webhook-real-senders` | `packages/sdk/src/plugins/plugins.ts`, from 2026-10-22 | It changes `fireTrigger` and adds `runAutomation`. `registerTunnelKind` goes in the same file, beside `registerAdapter` |
| Open PR #184 | `packages/computer/images/versions.json` | No overlap |

## The change

The change has five parts: the host's list, a kind of tunnel, the operations, a view's data, and another plugin's data.

### The host's list

- The host serves the list as a channel, `x-ahpd-tunnels://`, from the server package.
- A plugin adds a tunnel when the host calls its kind, and when it finds one at `listening`.
- The host saves each tunnel with its kind, its settings and `enabled`, in a collection of its `records` port. It starts each enabled tunnel when the daemon starts.
- A plugin reads the list. The canvas example builds its URL from the tunnel that forwards its port.
- The list feeds the routes' `Host` check, as announced names do today.
- A setting lets the API's `Host` check read the list too. It is off by default.

A kind's plugin config limits its tunnels by `purpose`:

| Setting for each purpose | What it does |
| --- | --- |
| The most tunnels | The host refuses a `create` over the limit. System access has one tunnel |
| Allowed | Whether the plugin opens tunnels for that purpose, such as a canvas |
| Close at the end | Whether a tunnel closes when the last thing it was opened for ends |

The host checks these settings, because it sets `purpose` and holds the list.

Each tunnel in the list has:

| Field | What it holds |
| --- | --- |
| `id` | The host's id for the tunnel |
| `kind` | The kind it is of, such as `devtunnel` |
| `port` | The local port it forwards |
| `url` | The address a remote client reaches |
| `anonymous` | Whether a person reaches it with no sign-in |
| `plugin` | The plugin that opened it |
| `purpose` | Why it was opened, such as system access to the daemon, or a canvas. The host sets it from what asked for the tunnel. It is not in the kind's form, and no person types it |
| `enabled` | Whether the host starts it when the daemon starts. A disabled tunnel keeps its settings and forwards nothing |
| `status` | `running`, `stopped` or `error`, with its `error` |
| `operation` | The call that runs on this tunnel now: `{ id, status, error }` |
| `owner` | Empty. Every record of the shared core has this field, and a tunnel belongs to the host |

### A kind of tunnel

A plugin registers a kind with `registerTunnelKind`, as it registers an adapter.
The manifest lists the kind's name in `contracts.tunnelKinds`, and the code gives the rest.
A plugin registers a kind during `apply`, so the kinds are fixed while the daemon runs.
The tunnels of a kind come and go at any time.

devtunnel's manifest:

```json
{ "contracts": { "tunnelKinds": ["devtunnel"] } }
```

devtunnel's kind:

```ts
host.registerTunnelKind({
  name: 'devtunnel',
  title: 'Dev Tunnel',
  description: 'A port forwarded by Microsoft Dev Tunnels, with its own URL.',
  icons: [{ src: './icon.svg' }],
  schema: {
    type: 'object',
    properties: {
      port: { type: 'integer', title: 'Port', minimum: 1, maximum: 65535 },
      anonymous: { type: 'boolean', title: 'Anyone can open it', default: false },
    },
    required: ['port'],
  },
  operations: [
    { id: 'start' },
    { id: 'stop' },
    { id: 'restart', label: 'Start the relay again' },
    {
      id: 'anonymous',
      label: 'Anyone can open it',
      icon: 'globe',
      input: { type: 'object', properties: { on: { type: 'boolean', title: 'On' } }, required: ['on'] },
    },
  ],
  create: async (input) => {
    const tunnel = await forward(Number(input.port), input.anonymous === true);
    host.updateViewData('/tunnels', mine());
    return tunnel;
  },
  update: async (tunnel, input) => {
    await allow(tunnel.id, input.anonymous === true);
    host.updateViewData('/tunnels', mine());
  },
  remove: async (tunnel) => {
    await unforward(tunnel.id);
    host.updateViewData('/tunnels', mine());
  },
  invoke: async (operation, tunnel, input) => {
    if (operation === 'start') await forward(tunnel.port, tunnel.anonymous);
    if (operation === 'stop') await unforward(tunnel.id);
    if (operation === 'restart') await relay(tunnel.id);
    if (operation === 'anonymous') await allow(tunnel.id, input.on === true);
    host.updateViewData('/tunnels', mine());
  },
});
```

Another plugin registers an `ssh` kind, which asks for other input:

```ts
host.registerTunnelKind({
  name: 'ssh',
  title: 'SSH tunnel',
  description: 'A port forwarded to a remote box with `ssh -R`.',
  schema: {
    type: 'object',
    properties: {
      port: { type: 'integer', title: 'Port', minimum: 1, maximum: 65535 },
      host: { type: 'string', title: 'Box', format: 'hostname' },
      user: { type: 'string', title: 'User' },
      key: { type: 'string', title: 'Private key', secret: true },
      remotePort: { type: 'integer', title: 'Port on the box' },
    },
    required: ['port', 'host', 'user', 'key'],
  },
  create: async (input) => { /* ... */ },
  remove: async (tunnel) => { /* ... */ },
});
```

- A name another plugin took is refused, as for adapters.
- The `key` field is marked `secret`, so the vault keeps it.
- The ssh kind gives no `update` and lists no runtime operations, so the host offers it only `create`, `remove`, `enable` and `disable`.

### The operations

The host puts the operations in the list's state, as a changeset does.
An operation carries `input`, the JSON Schema of what it asks for. A changeset operation has no input.
Each operation id is `<kind>/<name>`, and the operations fall into four groups:

| Group | Names | Who knows the name | The kind's code |
| --- | --- | --- | --- |
| A change to the list | `create`, `update`, `remove` | The host | `create(input)`, `update(target, input)`, `remove(target)` |
| What runs now | `start`, `stop`, `restart` | The host, with a fixed meaning and no input | `invoke(name, target)` |
| Whether it runs | `enable`, `disable` | The host alone, as the record's `enabled` | None: the host calls `start` or `stop` |
| The kind's own | Such as devtunnel's `anonymous` | The kind | `invoke(name, target, input)` |

A change to the list:

- `create` is offered on the list. Its input is the kind's `schema`.
- `update` is offered on each record when the kind gives an `update` handler. Its input is the kind's `schema`, filled with the record's values.
- A secret field comes back blank in `update`. A blank secret keeps the stored one, as an adapter's does.
- The host checks the input, moves each secret to the vault, and then calls the kind.
- The kind's `update` gets the running record. The kind applies the change live, or restarts the record itself.
- A kind with no `update` gets no update operation. A person removes the record and creates it again.
- `remove` is offered on each record, with a confirmation.

What runs now:

- A kind lists the runtime names it supports in `operations`, by id alone: `{ id: 'restart' }`.
- The host offers only the names a kind lists. A kind that cannot stop a record lists no `stop`.
- A kind can give a runtime name its own `label`. A machine's `restart` can read "Reboot".
- The host calls these names itself: it starts each enabled record when the daemon starts.
- There is one name for restart and reboot: `restart`.

Whether it runs:

- A new record is enabled.
- `disable` stops a running record, sets `enabled` to false, and keeps its settings.
- `enable` sets `enabled` to true and starts the record.
- The host offers `enable` and `disable` on every record. The kind gives no code for them.

The record's `status` is what runs now.
An operation on one record sets the record's `operation` while it runs, so each row shows its own call.
An operation on the list, such as `create`, keeps its `status` on the operation, as a changeset does.

The grant for each operation:

| Operation | Grant |
| --- | --- |
| `remove` | `tunnel:delete` |
| Every other operation | `tunnel:put` |

- A kind can name another grant for any of its operations, such as `tunnel:restart` or `tunnel:anonymous`.

The state of `x-ahpd-tunnels://` with the two kinds:

```json
{
  "tunnels": [
    { "id": "t1", "kind": "devtunnel", "port": 8443, "url": "https://example-8443.usw2.devtunnels.ms/", "anonymous": false, "plugin": "devtunnel", "purpose": "system access", "enabled": true, "status": "running" }
  ],
  "operations": [
    { "id": "devtunnel/create", "kind": "devtunnel", "label": "Dev Tunnel", "icon": "plug", "scopes": ["list"], "input": { "$ref": "the devtunnel schema" }, "status": "idle" },
    { "id": "ssh/create", "kind": "ssh", "label": "SSH tunnel", "icon": "terminal", "scopes": ["list"], "input": { "$ref": "the ssh schema" }, "status": "idle" },
    { "id": "devtunnel/update", "kind": "devtunnel", "label": "Edit", "icon": "edit", "scopes": ["tunnel"], "input": { "$ref": "the devtunnel schema" }, "status": "idle" },
    { "id": "devtunnel/remove", "kind": "devtunnel", "label": "Stop forwarding", "icon": "close", "scopes": ["tunnel"], "confirmation": "Stop forwarding this port?", "status": "idle" },
    { "id": "devtunnel/restart", "kind": "devtunnel", "label": "Start the relay again", "icon": "refresh", "scopes": ["tunnel"], "status": "idle" },
    { "id": "devtunnel/disable", "kind": "devtunnel", "label": "Disable", "icon": "pause", "scopes": ["tunnel"], "status": "idle" },
    { "id": "devtunnel/anonymous", "kind": "devtunnel", "label": "Anyone can open it", "icon": "globe", "scopes": ["tunnel"], "input": { "$ref": "the anonymous input" }, "status": "idle" },
    { "id": "ssh/remove", "kind": "ssh", "label": "Stop forwarding", "icon": "close", "scopes": ["tunnel"], "confirmation": "Stop forwarding this port?", "status": "idle" }
  ]
}
```

One command invokes them, as `invokeChangesetOperation` does. The same command serves every channel with operations, the computers too:

```json
{
  "method": "x-ahpd/invokeOperation",
  "params": {
    "channel": "x-ahpd-tunnels://",
    "operationId": "devtunnel/create",
    "input": { "port": 8080, "anonymous": false }
  }
}
```

- An operation on one tunnel takes `target: { "id": "t1" }`.
- The host refuses an operation its state does not list now, a target of the wrong scope, and an input that its schema refuses.
- The host checks the caller's grant before it calls the kind.
- The host sets the operation's `status` to `running`, and then to `idle` or to `error` with its `error`. Every subscriber sees it.
- The answer goes to the caller alone. Every subscriber sees the new tunnel in the list.

### A view's data

devtunnel's `main` view lists its tunnels from its data.
The "Forward a port" Button names the `devtunnel/create` operation and sends no input, so the client asks for it.
Each row's "Stop" Button names `devtunnel/remove` with its own row's `id`, so the client asks for nothing.

```ts
host.showView({
  root: 'card',
  components: {
    card: { id: 'card', component: 'Card', child: 'body' },
    body: { id: 'body', component: 'Column', children: ['head', 'rows'] },
    head: { id: 'head', component: 'Row', justify: 'spaceBetween', align: 'center', children: ['title', 'forward'] },
    title: { id: 'title', component: 'Text', variant: 'h3', text: 'Tunnels' },
    forward: {
      id: 'forward', component: 'Button', label: 'Forward a port',
      action: { event: { name: 'x-ahpd/invokeOperation', context: { channel: 'x-ahpd-tunnels://', operationId: 'devtunnel/create' } } },
    },
    rows: { id: 'rows', component: 'List', children: { path: '$/devtunnel/tunnels', componentId: 'row' } },
    row: { id: 'row', component: 'Row', justify: 'spaceBetween', align: 'center', children: ['url', 'port', 'stop'] },
    url: { id: 'url', component: 'Link', label: { path: 'url' }, href: { path: 'url' } },
    port: { id: 'port', component: 'Text', text: { path: 'port' } },
    stop: {
      id: 'stop', component: 'Button', label: 'Stop',
      action: { event: { name: 'x-ahpd/invokeOperation', context: { channel: 'x-ahpd-tunnels://', operationId: 'devtunnel/remove', target: { id: { path: 'id' } } } } },
    },
  },
  dataModel: {
    tunnels: [
      { id: 't1', kind: 'devtunnel', port: 8443, url: 'https://example-8443.usw2.devtunnels.ms/', anonymous: false },
    ],
  },
});
```

- `$/devtunnel/tunnels` is absolute: `devtunnel` is the namespace of the plugin's data in the client's store.
- `url`, `port` and `id` are relative, so inside a row they read the row's own item, as *What others do* says.
- `showView` takes the `dataModel`, as scena's `A2uiCreateSurface` has.
- `literalOf` accepts `{ path }`, and `children` accepts `{ path, componentId }`.
- `updateViewData(path, value)` sends one path of the plugin's data, as scena's `surface:update` takes it. The components stay as they are.

How the data reaches a client:

- The data rides the plugin's row on the plugins channel. No new channel is made for a plugin's data.
- A plugin's page subscribes to that plugin's row alone: `x-ahpd-plugins://?id=devtunnel`. The records channel takes `id` as a second query, beside `owner`.
- The snapshot holds the row with its views and its data.
- `updateViewData` sends a new action, `x-ahpd-plugins/viewData` `{ id, surface, path, value }`. It goes only to the clients subscribed to that plugin's row, not the whole row to every client of the list.
- ahpw follows the row while the page shows it, writes the data to the plugin's namespace, and gives the view its data context.

A person clicks "Forward a port":

1. The Button names `x-ahpd/invokeOperation` with the channel and `devtunnel/create`. ahpw follows `x-ahpd-tunnels://` and finds the operation in its state.
2. The operation's `input` requires `port`, and the Button sent none. ahpw draws a form with a "Port" field and an "Anyone can open it" switch.
3. The person types `8080` and confirms. ahpw sends the request with `input` on its connection.
4. The host checks the operation, the input and the grant. It sets the operation to `running` and calls devtunnel's `create`.
5. devtunnel forwards the port and sends the new `/tunnels` of its view. The host adds the tunnel to the list and sets the operation to `idle`.
6. The host answers the request to ahpw alone. Every subscriber of the list sees the new tunnel, and every client on devtunnel's page draws a second row.

### Another plugin's data

A view can show data that another plugin holds, such as the clients of a `crm` plugin.
The data and the store are two registrations in two places:

| Where | What is registered | Who registers it |
| --- | --- | --- |
| The host | The data, as a channel such as `x-crm://clients`, with a grant for each reader | The `crm` plugin, with `registerChannel` |
| The client | A namespace in scena's store, such as `crm`, read as `$/crm/...` | The client, with `registerDataProvider` or its own `follow` |

- The client subscribes to the channel as the person, so the person sees only the records the channel lets them read.
- The plugin that draws the view never reads the other plugin's data. A copy in its own data would reach every reader of its row with its own grants.
- The view knows only `$/crm/...`. It never names the host or the channel's subscription.
- A view reads the clients with `{ path: '$/crm/clients' }`, and a row reads its own item with `{ path: 'name' }`.

## Answers

| What | Source |
| --- | --- |
| The host keeps the tunnels, the plugin that opened each, and where each is in use | Softov, 2026-11-02: "The server will need to keep a list of tunnels, the plugin that opened it, the where its in use." |
| Each plugin lists its tunnels on its `main` view from the view's data, and sends a change of its own data; no new channel for that | Softov, 2026-11-02: "I was aiming more to the plugin to list the tunnels inside the view main. using scena data logic... and to emmit a even of its own data... not a new channels for that." |
| A client calls an operation from any place and asks for the params it needs; the brief shows the code | Softov, 2026-11-02: "if the plugin register is operations.. a operaton can be translated to action on ui.. that be called on any place... that action was registered by a plugin, has a input... then it ask for the params it needs?" |
| A plugin's page subscribes to that plugin's row alone, and a data change goes only to those subscribers | Softov, 2026-11-02: "Subscribe to one plugin" |
| A plugin method's title, icon and input are in the manifest; `registerMethod` keeps the grant and the handler | Softov, 2026-11-02: "In the manifest" |
| Another plugin's data is read by the client, as the person, not copied by the plugin that draws the view | Softov, 2026-11-02: "The client, as the person" |
| The data is a channel on the host; the name a view reads it by is a namespace in the client's scena store | Softov, 2026-11-02: "the crm:// data is to be regitered as crm://data and onto the channel. while $crm is a register onto scena store info... right?" |
| The host owns the list and its operations, and a plugin adds a kind of tunnel. This replaces devtunnel's own `x-devtunnel/*` methods | Softov, 2026-11-02: "Host owns it, plugins by kind" |
| A kind is registered as an adapter is: the manifest lists its name, the code gives its title, description, icons and form | Softov, 2026-11-02: "Like adapters" |
| The operations are in the list's state and one command invokes them, with `invokeChangesetOperation` as the reference | Softov, 2026-11-02: "ok... put it as reference.." |
| Each kind asks for its own input, so a devtunnel tunnel and an ssh tunnel ask for different things | Softov, 2026-11-02: "that way I will be able like to create a tunnel devtunnel and a tunnel ssh with another plugin... while one ask for some info.. while another ask for another info?" |
| The tunnel kind and the computer kind go in the SDK now, with one shape. A brief for a generic thing and its kinds comes later, from the two built kinds | Softov, 2026-11-02: "for computer and tunnel it need to go into the sdk.. but inclemente the brief for the generic resource latter? So when refined we can see what we move to it?" |
| The operations fall into four groups: a change to the list, what runs now, whether it runs, and the kind's own, as *The operations* says | Softov, 2026-11-02: "write onto the brief" |
| The host stores each record, with its kind, its settings and `enabled`, and starts the enabled ones | Softov, 2026-11-02: "The host stores them" |
| The kind's `update` decides whether the change applies live or restarts the record | Softov, 2026-11-02: "The kind decides" |
| One command, `x-ahpd/invokeOperation`, serves every channel with operations | Softov, 2026-11-02: "One shared command" |
| The tunnels are built first. The first plan holds the shared core, the tunnel list and the devtunnel kind. A view's data, the ahpw forms and the canvas URL are later plans | Softov, 2026-11-02: "Tunnels first", "Core, tunnel list, devtunnel kind" |
| A call on one record shows on the record's `operation`. A call on the list keeps its status on the operation | Softov, 2026-11-02: "On the record" |
| The API's `Host` check reads the list only when a setting turns it on. The setting is off by default | Softov, 2026-11-02: "A setting, off by default" |
| Each tunnel records the plugin that opened it and why it was opened, such as system access or a canvas | Softov, 2026-11-02: "I was referring from why the tunnels was openned... like was a tunnel for the system access. a tunnels for the canvas.. that thing." |
| A kind's plugin config limits its tunnels by purpose: the most tunnels, whether it opens tunnels for that purpose, and whether a tunnel closes when its last use ends | Softov, 2026-11-02: "so we can enforce like in plugin config limit qtd tunnel by purpose.. like system tunnel only one... and if it can open tunnel for canvas, etc.. also if close the tunnel if last user." |
| A record of the shared core has an optional `owner`, with the `?owner=me` filter. Computers fill it with the person who made the machine. Tunnels leave it empty, so a tunnel belongs to the host | Softov, 2026-11-02: "Optional owner" |
| `remove` needs `<thing>:delete` and every other operation `<thing>:put`. A kind can name another grant for an operation, such as `<thing>:restart` | Softov, 2026-11-02: "host by group, kind own may name one... like it if wanted could name <thing>:restart or <thing>:<action> if wanted otherwise will write <thing>:put" |

## Open points

1. Who maps a namespace to its channel, such as `crm` to `x-crm://clients`? The view could name its sources, the manifest could, or the client could hold a fixed list.
2. ahpw keeps a followed channel at `$/ahp/hosts/<host>/channels/<uri>`. Does a source get its own namespace, such as `$/crm`, or a short name under that path? Not checked: whether scena lets a page register a namespace while it shows, and unregister it after.
3. Is `?id=<plugin>` a query of the plugins channel, or does each plugin's row get its own URI?
4. Does devtunnel's view list its tunnels from its own data, or read `x-ahpd-tunnels://` filtered by its kind? The second keeps one copy of each tunnel.
5. Does a plugin's own method still get its title, icon and input in the manifest, now that the tunnel operations are the host's?
6. When two kinds can forward a port, which kind does the canvas example ask for?
7. When a canvas and a person ask for the same port, is it one tunnel or two?
8. Does the list hold addresses that are not tunnels, such as Softov's ahpw proxy?
9. Does `say` stay for `ahpd status`, beside the list?
10. Not checked: whether a running `devtunnel host` serves a port added after it started.
