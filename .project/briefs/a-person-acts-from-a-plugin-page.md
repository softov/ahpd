---
title: A person acts from a plugin's page
created: 2026-11-02
refs:
  - git://9d1cc04e - the commit of ahpd the facts were checked at
  - git://2ed435c - the commit of ahpw the facts were checked at
  - git://171e90619c7 - the commit of VS Code the facts were checked at
  - "[code://packages/sdk/src/types/plugin.ts#L924](../../packages/sdk/src/types/plugin.ts#L924) - `showView`, the page a plugin draws on its row"
  - "[code://packages/sdk/src/types/plugin.ts#L1200](../../packages/sdk/src/types/plugin.ts#L1200) - `registerMethod`, the `x-` command a Button calls"
  - "[code://packages/sdk/src/types/plugin.ts#L1270](../../packages/sdk/src/types/plugin.ts#L1270) - `openCanvas(chat, state)`, which needs a chat"
  - "[code://packages/sdk/src/types/plugin.ts#L1152](../../packages/sdk/src/types/plugin.ts#L1152) - `connect`, a plugin as a client of its own host"
  - "[code://packages/sdk/src/types/plugin.ts#L764](../../packages/sdk/src/types/plugin.ts#L764) - `say`, the only way a plugin gives the host an address today"
  - "[code://docs/plugins/PLUGINS.md#L877-L897](../../docs/plugins/PLUGINS.md#L877-L897) - a view, its Button, and why a Button's `context` is a literal"
  - "[code://packages/tunnel-devtunnel/src/plugin.ts#L149-L235](../../packages/tunnel-devtunnel/src/plugin.ts#L149-L235) - the one tunnel devtunnel holds, made at `listening`"
  - "[code://packages/tunnel-devtunnel/src/plugin.ts#L205](../../packages/tunnel-devtunnel/src/plugin.ts#L205) - what devtunnel says: an id and a port, no URL"
  - "[code://packages/tunnel-devtunnel/src/view.ts#L38-L66](../../packages/tunnel-devtunnel/src/view.ts#L38-L66) - devtunnel's page: state only, no Button"
  - "[code://packages/server/src/commands/run.ts#L140-L152](../../packages/server/src/commands/run.ts#L140-L152) - `announcedNames`, the URLs read out of `say` lines"
  - "[code://packages/server/src/commands/run.ts#L1667](../../packages/server/src/commands/run.ts#L1667) - announced names reach the routes' `Host` check"
  - "[code://packages/server/src/commands/run.ts#L580](../../packages/server/src/commands/run.ts#L580) - the API's `Host` check, which reads only configured names"
  - https://github.com/softov/ahpw/blob/2ed435c/src/resources/plugins/PluginViewPanel.tsx#L18 - ahpw sends a Button's request
  - https://github.com/microsoft/vscode/blob/171e90619c7/src/vs/platform/tunnel/common/tunnel.ts#L126-L144 - `ITunnelService`, the list of open tunnels and one provider
  - https://github.com/microsoft/vscode/blob/171e90619c7/src/vs/workbench/contrib/remote/browser/tunnelView.ts#L1112-L1116 - the Ports view's "Forward a Port" action
  - https://github.com/microsoft/vscode/blob/171e90619c7/src/vscode-dts/vscode.proposed.resolvers.d.ts#L45 - `registerTunnelProvider`, how an extension gives VS Code tunnels
  - file:///github/ahpd/.project/briefs/an-agent-makes-a-canvas.md - the canvas brief; how a canvas is served stays there
---

# A person acts from a plugin's page

The goal is that a person opens a canvas with no agent, from a Button on a plugin's page.
Softov runs ahpw on a public address, and ahpw is a proxy to ahpd.
He wants to see a canvas in that setup before an agent makes one.
The same page then gives the devtunnel plugin actions, such as "add a tunnel".
A model tool can do the same work, behind a setting.
The host can keep a list of the addresses that tunnels give, so a plugin builds a URL that a remote client reaches.
How the host serves a canvas page is in [an-agent-makes-a-canvas.md](an-agent-makes-a-canvas.md), not here.

## What others do

VS Code keeps the tunnels in one service, and a person acts on them from the Ports view.

- `ITunnelService` holds `tunnels`, the open tunnels, and raises `onTunnelOpened` ([tunnel.ts](https://github.com/microsoft/vscode/blob/171e90619c7/src/vs/platform/tunnel/common/tunnel.ts#L126-L144)).
- One provider makes the tunnels, set with `setTunnelProvider`. An extension gives it with `registerTunnelProvider`, a proposed API ([resolvers.d.ts](https://github.com/microsoft/vscode/blob/171e90619c7/src/vscode-dts/vscode.proposed.resolvers.d.ts#L45)).
- The Ports view has a "Forward a Port" action ([tunnelView.ts](https://github.com/microsoft/vscode/blob/171e90619c7/src/vs/workbench/contrib/remote/browser/tunnelView.ts#L1112-L1116)).
- A canvas in VS Code opens from the Copilot runtime only, as the canvas brief says.

## What ahpd has today

A plugin's page can already run the plugin's code:

- `showView` draws an A2UI view on the plugin's row ([`code://packages/sdk/src/types/plugin.ts`](../../packages/sdk/src/types/plugin.ts#L924)).
- A Button's `action` names an `x-` method that the same plugin registered with `registerMethod` ([`code://packages/sdk/src/types/plugin.ts`](../../packages/sdk/src/types/plugin.ts#L1200)).
- The host checks the method's grant for the person who clicks.
- ahpw draws the Button and sends the request ([PluginViewPanel.tsx](https://github.com/softov/ahpw/blob/2ed435c/src/resources/plugins/PluginViewPanel.tsx#L18)).

What is missing for a canvas:

- `openCanvas` needs a chat ([`code://packages/sdk/src/types/plugin.ts`](../../packages/sdk/src/types/plugin.ts#L1270)).
- A Button's `context` is a literal, and the host refuses a `{ path }` binding ([PLUGINS.md](../../docs/plugins/PLUGINS.md#L877-L897)). So the page cannot send the chat the person reads.
- A plugin can list the sessions and their chats through `connect` ([`code://packages/sdk/src/types/plugin.ts`](../../packages/sdk/src/types/plugin.ts#L1152)). It can then draw one Button per chat, with the chat in each `context`.
- The example plugin on the `plugin/canvas-example` branch has a route and a model tool, and no page. That branch is not on main.

The devtunnel plugin:

- It holds one tunnel. It finds the tunnel by the `_ahpd` label or makes one at `listening` ([`code://packages/tunnel-devtunnel/src/plugin.ts`](../../packages/tunnel-devtunnel/src/plugin.ts#L149-L235)).
- Its page shows state and has no Button ([`code://packages/tunnel-devtunnel/src/view.ts`](../../packages/tunnel-devtunnel/src/view.ts#L38-L66)).
- It registers no method and no tool.

The addresses the host knows:

- A plugin gives an address only through `say` ([`code://packages/sdk/src/types/plugin.ts`](../../packages/sdk/src/types/plugin.ts#L764)). The host keeps a line only while `listening` is handled, and drops a later one.
- `announcedNames` reads the URLs out of those lines ([`code://packages/server/src/commands/run.ts`](../../packages/server/src/commands/run.ts#L140-L152)).
- Only the routes' `Host` check reads those names ([`code://packages/server/src/commands/run.ts`](../../packages/server/src/commands/run.ts#L1667)). The API's check reads only `resource` and `origins` ([`code://packages/server/src/commands/run.ts`](../../packages/server/src/commands/run.ts#L580)).
- devtunnel says `tunnel <id>, port 31546`, with no URL ([`code://packages/tunnel-devtunnel/src/plugin.ts`](../../packages/tunnel-devtunnel/src/plugin.ts#L205)). So its address is in no name list.
- No plugin can read the addresses another plugin gave.

## Who writes

| Writer | Files | What the change does to it |
| --- | --- | --- |
| The `plugin/canvas-example` branch | `examples/canvas/`, `packages/server/src/plugins.ts` and the `--plugin` change | The example gets its page on that branch, before it goes to main |
| `release/prerelease-channel` worktree | Release files | No overlap |
| ahpw | Plugin page drawing | No change when the view uses only the kinds ahpw draws today |

No open PR on softov/ahpd at the time of writing.

## The change

The example plugin's page:

- The page lists the live chats, each with an "Open canvas" Button.
- The Button calls `x-example-canvas/open` with the chat in its `context`. The method calls `openCanvas`.
- The page draws again when a chat opens or closes.
- The model tool stays, so an agent can still open the canvas.

The canvas URL, one setting per case, each with its own default:

| Case | URL |
| --- | --- |
| A client on the daemon's machine | The bound address, read as loopback |
| A proxy such as Softov's ahpw | The `origin` option |
| A tunnel | An address from the host's list |

devtunnel actions, each a method that a Button calls:

- Add a tunnel, and remove one.
- Turn anonymous access on and off.
- Start the relay again after it stopped.

A model tool for each action is an option of the plugin. It is off by default, because a tool reaches every session's model.

The host's list of addresses:

- A plugin adds an address and removes it at any time, not only at `listening`.
- The host keeps the list, with the plugin that gave each one.
- The list feeds the routes' `Host` check, as announced names do today. The API's check reads it behind a setting.
- A plugin can read the list. The example builds its canvas URL from it.
- A client sees the list on the plugins channel.

## Open points

1. Does the page list the chats, or does the client send the chat it shows? The second needs a binding, which a later plan brings.
2. What is a second devtunnel tunnel for: a second port, or a second account?
3. Is the list a list of tunnels, or of addresses? A proxy address, such as Softov's ahpw, is not a tunnel.
4. Does `say` stay, beside the list, for `ahpd status`?
5. Does the API's `Host` check read the list by default?
