---
title: An agent makes a canvas
created: 2026-11-01
refs:
  - git://9d1cc04e - the commit of ahpd the facts were checked at
  - git://171e90619c7 - the commit of VS Code the facts were checked at
  - https://github.com/microsoft/agent-host-protocol/blob/main/types/channels-canvas/state.ts - `CanvasState` and `CanvasReference`; a canvas is a URL and a few strings, with no rule on what makes the page, and `url` is an absolute HTTP(S) URL
  - https://github.com/microsoft/agent-host-protocol/blob/main/types/channels-canvas/actions.ts - `canvas/stateChanged`, the only canvas action, which replaces the whole state
  - https://github.com/microsoft/agent-host-protocol/blob/main/types/channels-chat/actions.ts - `chat/pendingMessageSet`, a queued message that starts a turn when the chat is idle
  - "[code://packages/sdk/src/host/canvases.ts#L1-L60](../../packages/sdk/src/host/canvases.ts#L1-L60) - the store of open canvases, per chat, in memory, gated by `enabled()`"
  - "[code://packages/sdk/src/types/plugin.ts#L1259-L1285](../../packages/sdk/src/types/plugin.ts#L1259-L1285) - `openCanvas`, `updateCanvas` and `closeCanvas`, the three plugin calls"
  - "[code://packages/sdk/src/types/plugin.ts#L1156](../../packages/sdk/src/types/plugin.ts#L1156) - `registerTool`, how a plugin gives a host tool to every session"
  - "[code://packages/sdk/src/types/plugin.ts#L1365-L1377](../../packages/sdk/src/types/plugin.ts#L1365-L1377) - `registerRoute`, one HTTP route per plugin, with no credential in front"
  - "[code://packages/sdk/src/plugins/plugins.ts#L144-L145](../../packages/sdk/src/plugins/plugins.ts#L144-L145) - `routePrefix`, which serves a plugin's route at `/plugins/<name>/`"
  - "[code://packages/server/src/http.ts#L75-L80](../../packages/server/src/http.ts#L75-L80) - `hostRefusal`, which the API and the routes use to answer only a `Host` the daemon knows"
  - "[code://packages/sdk/src/listen.ts#L369-L381](../../packages/sdk/src/listen.ts#L369-L381) - `verifyClient`, which admits an AHP upgrade by its token alone"
  - "[code://packages/server/src/http.ts#L194-L200](../../packages/server/src/http.ts#L194-L200) - `pluginRoutes`, where the daemon answers a path under `/plugins/`"
  - "[code://packages/server/src/commands/run.ts#L140-L152](../../packages/server/src/commands/run.ts#L140-L152) - `announcedNames`, the names a plugin announces, such as a tunnel's"
  - "[code://packages/server/src/commands/run.ts#L1667](../../packages/server/src/commands/run.ts#L1667) - the known names: loopback, the bound address, `resource`, and the announced names"
  - "[code://packages/server/src/config.ts#L28-L40](../../packages/server/src/config.ts#L28-L40) - `RoutesSetting`, which can move the routes to a listener of their own"
  - "[code://packages/server/src/config.ts#L184-L191](../../packages/server/src/config.ts#L184-L191) - `resource`, the public URL a deployment names"
  - "[code://packages/sdk/src/host/chatactions.ts#L1229](../../packages/sdk/src/host/chatactions.ts#L1229) - the host already takes `chat/pendingMessageSet`"
  - "[code://packages/sdk/src/plugins/pluginparts.ts#L1-L28](../../packages/sdk/src/plugins/pluginparts.ts#L1-L28) - the parts a session plugin holds, each read from its own folder"
  - "[code://packages/sdk/src/host.ts#L1360-L1365](../../packages/sdk/src/host.ts#L1360-L1365) - where the host builds the store and reads `canvasesEnabled === true`"
  - "[code://packages/sdk/src/vscoderootconfig.ts#L210](../../packages/sdk/src/vscoderootconfig.ts#L210) - `canvasesEnabled`, copied from VS Code with `default: false`"
  - file:///github/ahpd/.project/plans/host/116-a-plugin-opens-a-canvas-on-a-chat/plan.md - the plan that built the store and the three plugin calls
  - https://github.com/microsoft/vscode/blob/171e90619c7/src/vs/platform/agentHost/node/copilot/copilotSessionLauncher.ts#L1359-L1363 - VS Code turns canvases on only for a Copilot SDK session
  - https://github.com/microsoft/vscode/blob/171e90619c7/src/vs/platform/agentHost/test/node/copilotSdkCanvas.integrationTest.ts#L60-L71 - a Copilot canvas: an `extension.mjs` whose `open` answers a `127.0.0.1` URL
  - https://github.com/microsoft/vscode/blob/171e90619c7/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostChatContribution.ts#L421 - VS Code shows canvases only for the local agent host
  - https://github.com/microsoft/vscode/blob/171e90619c7/src/vs/platform/agentHost/common/agentHostStarter.config.contribution.ts#L223-L230 - `chat.canvases.enabled`, `default: false`, sent to the host as `canvasesEnabled`
  - https://github.com/microsoft/vscode/blob/171e90619c7/src/vs/platform/agentHost/common/agentHostConfigurationSync.ts#L63-L75 - a value no layer sets is sent as the registered default
  - https://github.com/microsoft/vscode/blob/171e90619c7/src/vs/platform/agentHost/common/agentHostConfigurationSync.ts#L182-L195 - the patch a window sends on each connect and reconnect
  - git://2ed435c - the commit of ahpw the facts were checked at
  - https://github.com/softov/ahpw/blob/2ed435c/src/lib/api.ts#L8-L35 - ahpw keeps the connection token in `localStorage`, and has a mode where its server holds the token
  - "[code://packages/server/src/proxy/listener.ts#L129](../../packages/server/src/proxy/listener.ts#L129) - the proxy does not pass `Set-Cookie` back"
  - https://github.com/mdn/browser-compat-data/blob/main/api/FetchEvent.json - `clientId` and `resultingClientId` in every engine; no `replacesClientId`, read 2026-11-02
  - file:///github/ahpd/.project/briefs/a-person-acts-from-a-plugin-page.md - the host's list of addresses, which a `tunnel` way reads
---

# An agent makes a canvas

The goal is that an agent in an ahpd chat makes a canvas, and every client shows it, local or remote.
A canvas is a page beside the chat.
ahpw already draws the canvases a chat lists, so the missing part is on the host.
The host keeps the list of canvas types and serves every canvas page.
What makes a page is a source, and no source is required: not Copilot, and not an `extension.mjs`.

## What others do

VS Code has one source of canvases: a Copilot SDK extension.

- An extension is an `extension.mjs` that runs its own HTTP server and answers a `127.0.0.1` URL, as the [integration test](https://github.com/microsoft/vscode/blob/171e90619c7/src/vs/platform/agentHost/test/node/copilotSdkCanvas.integrationTest.ts#L60-L71) shows.
- An extension has three scopes: the user's (`~/.copilot/extensions/`), a workspace's (`.github/extensions/`), and a plugin's.
- The Copilot runtime keeps the list of canvas types, so only a Copilot session has canvases.
- The page talks back to its own server, so a page with no server cannot talk back.
- VS Code shows canvases only for the local agent host, because the URL opens only on that machine.
- A VS Code window sends `canvasesEnabled` on each connect and reconnect, to a remote host too. When its user never set `chat.canvases.enabled`, it sends the registered default, `false`. An experiment can change that default.

ahpd takes the protocol's `CanvasState` from this, and not the rest.

## What ahpd has today

- [`code://packages/sdk/src/host/canvases.ts`](../../packages/sdk/src/host/canvases.ts) keeps the open canvases of each chat, in memory only.
- A plugin opens, updates and closes a canvas with three calls, and must give a ready `url`.
- The store refuses every call while `canvasesEnabled` is not `true`, and `canvasesEnabled` defaults to `false`.
- The daemon serves plugin routes under `/plugins/<name>/`, with no credential in front. A route checks its own caller.
- The daemon keeps a list of known names: loopback, the bound address, the host of `resource`, and the URLs a plugin announces.
- The API and the plugin routes answer only a `Host` on that list. The AHP upgrade checks its token, not its `Host`.
- The host takes `chat/pendingMessageSet`, which queues a message on a chat and starts a turn when the chat is idle.
- A session plugin keeps its skills, agents and rules each in its own folder, which [`code://packages/sdk/src/plugins/pluginparts.ts`](../../packages/sdk/src/plugins/pluginparts.ts) reads.

What is missing:

- There is no list of canvas types, so nothing can say which canvases it can make.
- The host serves no canvas page. A canvas URL that names `127.0.0.1` breaks for a remote client.
- The protocol wants an absolute `url`, and one canvas has one state, but each client can reach the daemon at a different address.
- A page cannot send anything back to the chat.
- There is no model tool, so an agent cannot open a canvas.

## Who writes

| Writer | Files | What it does to the change |
|---|---|---|
| Fork plan `host/124`, kept as `fork/host-124-shell-integration` | `vscoderootconfig.ts` | It changes other entries, not `canvasesEnabled`. It is redone on main, so whichever lands second rebases. |
| Plan `plugin/20261031-1200-a-plugin-shows-its-state` | `types/plugin.ts`, `PLUGINS.md` | Merged. `registerCanvas` goes beside its `showView` calls. |

The fork plans `host/20261101-*`, MayCXC's `union` (`940c91fc`), `plugin/54` and `daemon/windows-stop-race` are on main already, so they write nothing more. `closeAll` clears `url` before it drops a canvas; a closed canvas's page must stop answering at the same point.

## Answers

Softov, 2026-11-01. Each answer is a default for now, not a lock.

| Point | Answer |
|---|---|
| Where a page folder lives | All three scopes, with ahpd's own paths: `~/.config/ahpd/canvases/`, `.ahpd/canvases/` in a workspace, and a `canvases/` part in a session plugin. |
| How a page changes | The protocol's way: `canvas/stateChanged` with a new `url`. The agent writes the files again, and the host puts a new version on the URL. |
| Who may make a canvas | A daemon setting. Its default: a page folder needs no grant, and a URL source and a plugin type need one. |
| The URL a client gets | `resource` when it is set. When it is not, the known name that the client's connection named in `Host`. |
| `canvasesEnabled` from VS Code | The host follows the value a client sends, as VS Code does. A VS Code user turns on `chat.canvases.enabled`. |

## The change

### The host keeps two lists

- The list of types: what canvases can be made, each with an `id`, a title, a description, an optional input schema, and its source.
- The list of open canvases: the store that host/116 built, unchanged in shape.
- `extensionId` names the source and `canvasId` names the type, so a client can tell two sources apart.

### The sources

Each source puts types in the host list. Each source has its own defaults and its own settings.

| Source | What makes the page | Owner of what the page sends |
|---|---|---|
| Page folder | Files: `index.html` and what it loads. The host serves them. No code runs. | The agent of the chat |
| URL | A server that already runs, such as a dev server or a dashboard | The agent of the chat |
| Plugin | The plugin's own code, through `PluginHost.registerCanvas` | The plugin |
| Copilot extension | An `extension.mjs` and its server, through an optional adapter | The extension |

A page folder is the simplest source, and an agent can write one.
The Copilot adapter comes last and nothing depends on it.

### Where a page folder lives

- The user's: `~/.config/ahpd/canvases/<name>/`.
- A workspace's: `<workspace>/.ahpd/canvases/<name>/`.
- A session plugin's: a `canvases/` part, beside its skills and agents.
- The skill asks the user which scope, and does not pick the workspace only because one is open.

### Who may make a canvas

- A daemon setting says which sources need a grant.
- The default: a page folder needs none. A URL source and a plugin type need one, because the proxy shows a remote client an address that only the daemon can reach.

### The host serves every canvas

- Each open canvas gets a random token. The token is in the path, such as `/canvases/<token>/`, or in the name, as *Where a canvas page is served* says.
- The host serves a page folder at that address, and proxies a URL source or a plugin page through it.
- The token is the credential, because an iframe sends no AHP credential. A closed canvas's token stops answering.
- The canvas path is on the listener that the client speaks AHP to, not on the `routes.port` listener. A client may not reach the routes listener.

A daemon setting turns the proxy off for a URL source and a plugin source.
With the proxy off, the host gives the source URL as it is, which works for a local client only.
The default is on.
A page folder is always served by the host, because it has no server of its own.

### Where a canvas page is served

A canvas page needs an origin that is not the client's origin. Softov, 2026-11-02: "a config... 1 port, a range, a tunnel or \"dns name\"... All depends from what is supported."

Why a path on the client's origin does not work:

- A path prefix breaks a page that asks for `/img/x.jpg`, a full `http://127.0.0.1:3214/` URL, or a WebSocket, such as a dev server's reload socket.
- A page on ahpw's origin can read ahpw's `localStorage`, which holds the connection token ([api.ts](https://github.com/softov/ahpw/blob/2ed435c/src/lib/api.ts#L8-L35)).
- An iframe sandboxed without `allow-same-origin` gets an opaque origin, and no service worker controls it.

An origin is a scheme, a host and a port, so a second port is a second origin. The ways, each one set or left out on its own:

| Way | What it needs | Origins | Canvases apart from each other |
| --- | --- | --- | --- |
| `loopback` | Nothing | One per canvas, `<token>.localhost:<port>` | Yes |
| `port` | One open port | One for all canvases; a service worker routes each request | No: storage and cookies are shared |
| `ports` | A range of ports | One per open canvas | Storage yes, cookies no |
| `tunnel` | A tunnel plugin that adds a port or a name | What the tunnel gives | Depends on the tunnel |
| `names` | A DNS wildcard and its certificate | One per canvas | Yes |

- Each connection gets the first way in a configured order that fits how it reached the host. A client on loopback gets `loopback`. A client through a proxy on a public IP, such as Softov's ahpw, gets `port`.
- Each source has its own setting for the ways it accepts. A plugin's own page can accept `port`. A page an agent made can need `names` or `ports`.
- When no way fits, the client shows the canvas with a line that says how to reach it.
- A `tunnel` way reads the host's list of addresses from [a-person-acts-from-a-plugin-page.md](a-person-acts-from-a-plugin-page.md).

Facts for `port`, the service worker way:

- A service worker knows the page of each request by `event.clientId`, and a new page by `event.resultingClientId`. Every engine has both. No engine has `replacesClientId`.
- So a navigation does not say which canvas it came from. The canvas keeps its token in its own path, and the worker redirects a navigation without the token to the path with it.
- The page then sees the token in `location.pathname`, which a client-side router reads.
- A page that a worker controls sends every same-origin request to it, outside its scope too. So the scope can be the canvas path only.
- A worker does not see a WebSocket, and a hard reload skips it. The host answers the canvas path itself for both.

Facts for `port` and `ports`:

- A cookie ignores the port. A canvas on a second port shares cookies with the client's origin and with every other canvas on that host.
- ahpw keeps no token in a cookie, and the proxy does not pass `Set-Cookie` back ([`code://packages/server/src/proxy/listener.ts`](../../packages/server/src/proxy/listener.ts#L129)).
- A browser applies no cross-origin rule to a WebSocket. When ahpw's server holds the token, the socket it serves must check `Origin`, or any page can use the token.

Not checked yet:

- Whether each Dev Tunnels port gets its own URL.
- Whether Safari, and the WebView2 that ahp-desk uses, send `*.localhost` to loopback.
- Whether ahpw's server checks `Origin` on the socket when it holds the token.

### The URL each client gets

- The `url` in `CanvasState` is absolute, as the protocol says.
- The way a connection gets, from *Where a canvas page is served*, gives the origin. The rest of this section gives the host name for `port` and `ports`.
- When `resource` is set, the URL is the token path under `resource`, for every client.
- When it is not, each connection gets the token path under the `Host` of its upgrade request.
- The host uses that `Host` only when it is on the list of known names, and takes the scheme from that name. A connection with another `Host` gets no `url`.
- The host sends each connection its own `url`, in the snapshot and in `canvas/stateChanged`. The rest of the state is the same for every client.
- `Origin` is not used. It names the client's page, not the daemon.

### A page changes by a new URL

- The protocol has one canvas action, `canvas/stateChanged`, and nothing in it reaches the page.
- When the agent writes a page folder's files again, the host puts a new version on the URL and sends `canvas/stateChanged`.
- ahpw loads the page again when the `url` changes. The page needs no bridge.

### A page talks back through the host

- A page posts to a fixed path under its own canvas URL.
- The host gives the post to the canvas owner, as *The sources* says.
- For the agent, the host sets a queued message on the chat with `chat/pendingMessageSet`, which starts a turn when the chat is idle.
- For a plugin, the host calls the type's own handler.

### Canvases are on by default

- `canvasesEnabled` defaults to `true`, and a user who wants no canvases sets `canvasesEnabled: false`.
- The host reads `canvasesEnabled !== false`, and the schema copy says `default: true`.
- The host follows the value a client sends. A VS Code window sends `false` unless its user turned on `chat.canvases.enabled`, so the default `true` holds only while no such window is connected.

### Steps

| # | Step | Needs |
|---|---|---|
| 1 | Check by hand that a plugin's `openCanvas` shows in ahpw | nothing |
| 2 | The list of types, `registerCanvas`, and `canvasesEnabled` on by default | nothing |
| 3 | The host serves every canvas at a token URL, with the proxy setting and the URL each client gets | nothing |
| 4 | A page talks back through the host | step 3 |
| 5 | The page folder source, in its three scopes, and the grant setting | step 3 |
| 6 | The model tools over the host list, as their own plan | step 2 |
| 7 | The URL source | step 3 |
| 8 | The Copilot extension adapter | step 3 |

The host offers the model tools only when the list has a type, so an empty list costs no tokens.
