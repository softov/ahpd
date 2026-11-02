---
title: An agent makes a canvas
created: 2026-11-01
refs:
  - git://39d1f22a - the commit of ahpd the facts were checked at
  - git://171e90619c7 - the commit of VS Code the facts were checked at
  - https://github.com/microsoft/agent-host-protocol/blob/main/types/channels-canvas/state.ts - `CanvasState` and `CanvasReference`; a canvas is a URL and a few strings, with no rule on what makes the page
  - https://github.com/microsoft/agent-host-protocol/blob/main/types/channels-chat/actions.ts - `chat/pendingMessageSet`, a queued message that starts a turn when the chat is idle
  - "[code://packages/sdk/src/host/canvases.ts#L1-L60](../../packages/sdk/src/host/canvases.ts#L1-L60) - the store of open canvases, per chat, in memory, gated by `enabled()`"
  - "[code://packages/sdk/src/types/plugin.ts#L1259-L1285](../../packages/sdk/src/types/plugin.ts#L1259-L1285) - `openCanvas`, `updateCanvas` and `closeCanvas`, the three plugin calls"
  - "[code://packages/sdk/src/types/plugin.ts#L1156](../../packages/sdk/src/types/plugin.ts#L1156) - `registerTool`, how a plugin gives a host tool to every session"
  - "[code://packages/sdk/src/types/plugin.ts#L1365-L1377](../../packages/sdk/src/types/plugin.ts#L1365-L1377) - `registerRoute`, one HTTP route per plugin, with no credential in front"
  - "[code://packages/sdk/src/plugins/plugins.ts#L144-L145](../../packages/sdk/src/plugins/plugins.ts#L144-L145) - `routePrefix`, which serves a plugin's route at `/plugins/<name>/`"
  - "[code://packages/server/src/http.ts#L194-L200](../../packages/server/src/http.ts#L194-L200) - `pluginRoutes`, where the daemon answers a path under `/plugins/`"
  - "[code://packages/server/src/config.ts#L28-L40](../../packages/server/src/config.ts#L28-L40) - `RoutesSetting`, which can move the routes to a listener of their own"
  - "[code://packages/sdk/src/host/chatactions.ts#L1205](../../packages/sdk/src/host/chatactions.ts#L1205) - the host already takes `chat/pendingMessageSet`"
  - "[code://packages/sdk/src/plugins/pluginparts.ts#L1-L28](../../packages/sdk/src/plugins/pluginparts.ts#L1-L28) - the parts a session plugin holds, each read from its own folder"
  - "[code://packages/sdk/src/host.ts#L1218-L1223](../../packages/sdk/src/host.ts#L1218-L1223) - where the host builds the store and reads `canvasesEnabled === true`"
  - "[code://packages/sdk/src/vscoderootconfig.ts#L210](../../packages/sdk/src/vscoderootconfig.ts#L210) - `canvasesEnabled`, copied from VS Code with `default: false`"
  - file:///github/ahpd/.project/plans/host/116-a-plugin-opens-a-canvas-on-a-chat/plan.md - the plan that built the store and the three plugin calls
  - https://github.com/microsoft/vscode/blob/171e90619c7/src/vs/platform/agentHost/node/copilot/copilotSessionLauncher.ts#L1359-L1363 - VS Code turns canvases on only for a Copilot SDK session
  - https://github.com/microsoft/vscode/blob/171e90619c7/src/vs/platform/agentHost/test/node/copilotSdkCanvas.integrationTest.ts#L60-L71 - a Copilot canvas: an `extension.mjs` whose `open` answers a `127.0.0.1` URL
  - https://github.com/microsoft/vscode/blob/171e90619c7/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostChatContribution.ts#L421 - VS Code shows canvases only for the local agent host
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
- The Copilot runtime keeps the list of canvas types, so only a Copilot session has canvases.
- The page talks back to its own server, so a page with no server cannot talk back.
- VS Code shows canvases only for the local agent host, because the URL opens only on that machine.

ahpd takes the protocol's `CanvasState` from this, and not the rest.

## What ahpd has today

- [`code://packages/sdk/src/host/canvases.ts`](../../packages/sdk/src/host/canvases.ts) keeps the open canvases of each chat, in memory only.
- A plugin opens, updates and closes a canvas with three calls, and must give a ready `url`.
- The store refuses every call while `canvasesEnabled` is not `true`, and `canvasesEnabled` defaults to `false`.
- The daemon serves plugin routes under `/plugins/<name>/`, with no credential in front. A route checks its own caller.
- The host takes `chat/pendingMessageSet`, which queues a message on a chat and starts a turn when the chat is idle.
- A session plugin keeps its skills, agents and rules each in its own folder, which [`code://packages/sdk/src/plugins/pluginparts.ts`](../../packages/sdk/src/plugins/pluginparts.ts) reads.

What is missing:

- There is no list of canvas types, so nothing can say which canvases it can make.
- The host serves no canvas page. A canvas URL that names `127.0.0.1` breaks for a remote client.
- A page cannot send anything back to the chat.
- There is no model tool, so an agent cannot open a canvas.

## Who writes

| Writer | Files | What it does to the change |
|---|---|---|
| Fork plans `host/20261101-*` and `maycxc/union` | `canvases.ts`, `host.ts`, `PLUGINS.md` | `closeAll` clears `url` before it drops a canvas. A closed canvas's route must stop answering at the same point. |
| Fork plan `host/124` | `host.ts`, `vscoderootconfig.ts` | It rewrites comments near `canvasesEnabled`, not the entry. The default change rebases on it. |
| Fork plan `plugin/54` | `plugins/plugins.ts` | It changes route handling for webhooks. The canvas routes rebase on it. |
| Plan `plugin/20261031-1200-a-plugin-shows-its-state` | `types/plugin.ts`, `PLUGINS.md` | Merged at `1c6e2d9f`. `registerCanvas` goes beside its `showView` calls. |

## The change

### The host keeps two lists

- The list of types: what canvases can be made, each with an `id`, a title, a description, an optional input schema, and its source.
- The list of open canvases: the store that host/116 built, unchanged in shape.
- `extensionId` names the source and `canvasId` names the type, so a client can tell two sources apart.

### The sources

Each source puts types in the host list. The host treats them all the same way.

| Source | What makes the page | Owner of what the page sends |
|---|---|---|
| Page folder | Files: `index.html` and what it loads. The host serves them. No code runs. | The agent of the chat |
| URL | A server that already runs, such as a dev server or a dashboard | The agent of the chat |
| Plugin | The plugin's own code, through `PluginHost.registerCanvas` | The plugin |
| Copilot extension | An `extension.mjs` and its server, through an optional adapter | The extension |

A page folder is the simplest source, and an agent can write one.
The Copilot adapter comes last and nothing depends on it.

### The host serves every canvas

- Each open canvas gets a host URL with a random token, such as `/canvases/<token>/`.
- The host serves a page folder from that URL, and proxies a URL source or a plugin page through it.
- The token is the credential, because an iframe sends no AHP credential. A closed canvas's token stops answering.
- The `url` in `CanvasState` is the host URL, so every client opens every canvas the same way.

A daemon setting turns the proxy off for a URL source and a plugin source.
With the proxy off, the host gives the source URL as it is, which works for a local client only.
The default is on.
A page folder is always served by the host, because it has no server of its own.

### A page talks back through the host

- A page posts to a fixed path under its own canvas URL.
- The host gives the post to the canvas owner, as *The sources* says.
- For the agent, the host sets a queued message on the chat with `chat/pendingMessageSet`, which starts a turn when the chat is idle.
- For a plugin, the host calls the type's own handler.

### Canvases are on by default

- `canvasesEnabled` defaults to `true`, and a user who wants no canvases sets `canvasesEnabled: false`.
- The host reads `canvasesEnabled !== false`, and the schema copy says `default: true`.

### Steps

| # | Step | Needs |
|---|---|---|
| 1 | Check by hand that a plugin's `openCanvas` shows in ahpw | nothing |
| 2 | The list of types, `registerCanvas`, and `canvasesEnabled` on by default | nothing |
| 3 | The host serves every canvas at a token URL, with the proxy setting | nothing |
| 4 | A page talks back through the host | step 3 |
| 5 | The page folder source | step 3 |
| 6 | The model tools over the host list, as their own plan | step 2 |
| 7 | The URL source | step 3 |
| 8 | The Copilot extension adapter | step 3 |

The host offers the model tools only when the list has a type, so an empty list costs no tokens.

## Open points

- Where does a page folder live: in a session plugin as a `canvases/` part, in the workspace, in the user's config, or all three?
- How does an agent change what a page shows: by writing the files again, or by a message the host pushes to the page?
- Who may make a canvas: every agent, or one with a grant?
- Does a VS Code window push `canvasesEnabled: false` when its user never set it? Not checked.
- Does the canvas route go on the routes listener when `routes.port` moves it?
