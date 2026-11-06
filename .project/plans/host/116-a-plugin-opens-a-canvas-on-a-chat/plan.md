---
title: A plugin opens a canvas on a chat
domain: host
status: built
priority: medium
created: 2026-10-22
revalidated: 2026-10-28
requires: []
changes: []
creates: []
decisions: []
refs:
  - "[code://packages/sdk/src/host.ts#L622-L686](../../../../packages/sdk/src/host.ts#L622-L686) - `seenBy`, the one per-connection filter for the live broadcast and both replay paths"
  - "[code://packages/sdk/src/host.ts#L717-L755](../../../../packages/sdk/src/host.ts#L717-L755) - `emit`, which keeps the replay buffer and broadcasts through `seenBy`"
  - "[code://packages/sdk/src/host.ts#L773-L823](../../../../packages/sdk/src/host.ts#L773-L823) - `dispatch`, the call a host-owned chat action goes through"
  - "[code://packages/sdk/src/host/handshake.ts#L149-L227](../../../../packages/sdk/src/host/handshake.ts#L149-L227) - the negotiation; `agreed` is logged and answered, and the connection does not keep it"
  - "[code://packages/sdk/src/types/host.ts#L1084-L1175](../../../../packages/sdk/src/types/host.ts#L1084-L1175) - `Connection`, which has no protocol version field"
  - "[code://packages/sdk/src/host/snapshots.ts#L73-L90](../../../../packages/sdk/src/host/snapshots.ts#L73-L90) - `snapshotOf`, which answers a plugin channel by its scheme: the place for the `ahp-canvas:` branch"
  - "[code://packages/sdk/src/host/snapshots.ts#L322-L351](../../../../packages/sdk/src/host/snapshots.ts#L322-L351) - the chat snapshot, with `movable` laid over the backend's state: the pattern for `canvases`"
  - "[code://packages/sdk/src/host/catalogue.ts#L218-L252](../../../../packages/sdk/src/host/catalogue.ts#L218-L252) - `movableMoved` dispatches `chat/movableChanged`: the host-owned chat action to mirror"
  - "[code://packages/sdk/src/host/routing.ts#L391-L396](../../../../packages/sdk/src/host/routing.ts#L391-L396) - `channelKind` reads an unclaimed `ahp-` channel as `other`"
  - "[code://packages/sdk/src/host/channels.ts#L37-L44](../../../../packages/sdk/src/host/channels.ts#L37-L44) - `spaceOf` puts `ahp-canvas` in the host's own space"
  - "[code://packages/sdk/src/host/channels.ts#L77-L81](../../../../packages/sdk/src/host/channels.ts#L77-L81) - `URI_KEYS` holds `resource` and `url`, which `respelledIn` rewrites"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L214-L223](../../../../packages/sdk/src/host/sessionmethods.ts#L214-L223) - a chat moved to another session leaves `byChat`"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L1468-L1474](../../../../packages/sdk/src/host/sessionmethods.ts#L1468-L1474) - a removed session disposes its chats"
  - "[code://packages/sdk/src/host/lifecycle.ts#L241-L262](../../../../packages/sdk/src/host/lifecycle.ts#L241-L262) - a closed session lets its chats go"
  - "[code://packages/sdk/src/host/trust.ts#L172](../../../../packages/sdk/src/host/trust.ts#L172) - a root key read from `rootConfig`: the pattern for `canvasesEnabled`"
  - "[code://packages/sdk/src/vscoderootconfig.ts#L206-L211](../../../../packages/sdk/src/vscoderootconfig.ts#L206-L211) - `canvasesEnabled`, declared with default `false` and read by nothing"
  - "[code://packages/sdk/src/types/plugin.ts#L943](../../../../packages/sdk/src/types/plugin.ts#L943) - `sessionOwner`, a late-bound call on `PluginHost`"
  - "[code://packages/sdk/src/types/plugin.ts#L1081-L1096](../../../../packages/sdk/src/types/plugin.ts#L1081-L1096) - `planChanged` and `sessionMetaChanged`, the calls that throw until a host is built"
  - "[code://packages/sdk/src/plugins/plugins.ts#L1476-L1486](../../../../packages/sdk/src/plugins/plugins.ts#L1476-L1486) - `planChanged`, which throws by name when no host filled `changed` in"
  - "[code://packages/sdk/src/host/facts.ts#L610-L620](../../../../packages/sdk/src/host/facts.ts#L610-L620) - the host fills a plugin's late-bound call in after the fold"
  - "[code://packages/sdk/test/host-handshake.test.ts#L37-L62](../../../../packages/sdk/test/host-handshake.test.ts#L37-L62) - the test that proves ahpd sends no canvas action, which this plan replaces"
  - "[code://packages/server/src/pluginschannel.ts#L11-L13](../../../../packages/server/src/pluginschannel.ts#L11-L13) - a change to the plugins applies at once, so a plugin can unload while its canvases are open"
  - "[code://docs/plugins/PLUGINS.md#L189-L220](../../../../docs/plugins/PLUGINS.md#L189-L220) - the `PluginHost` method table"
  - npm://@microsoft/agent-host-protocol@1.0.0 - `CanvasReference`, `CanvasState`, `chat/canvasesChanged`, `canvas/stateChanged`, both server-only, both registered at `0.10.0`, and `isActionKnownToVersion` (`src/types/version/registry.ts:158-159`, `216`)
  - https://github.com/microsoft/agent-host-protocol/blob/main/types/channels-canvas/state.ts - `instanceId` is caller-supplied; `url` is absolute HTTP(S), cleared when the provider is unavailable, redacted from logs and never reused after a restart
  - https://github.com/microsoft/agent-host-protocol/blob/main/docs/specification/versioning.md - the Canvas channel is "1 - Experimental" (L42); a host MUST NOT send newer-version-only behaviour to an older connection (L120); an older peer ignores an added field (L85)
  - https://github.com/microsoft/agent-host-protocol/blob/main/docs/specification/subscriptions.md - `ahp-canvas:/<id>` holds one `CanvasState`, listed in `ChatState.canvases` (L28)
  - https://github.com/microsoft/vscode/blob/e646868227c/src/vs/platform/agentHost/common/canvasUri.ts - `buildCanvasUri(chat, id)` is `ahp-canvas:/<base64url(chat)>/<id>`, and `parseCanvasChatUri` reads the chat back
  - https://github.com/microsoft/vscode/blob/e646868227c/src/vs/platform/agentHost/node/agentHostStateManager.ts#L1077-L1100 - `setCanvasState` installs the state before the chat lists the channel; `_pruneChatCanvases` drops a canvas the list no longer holds
  - https://github.com/microsoft/vscode/blob/e646868227c/src/vs/platform/agentHost/node/agentService.ts#L6005-L6048 - `openSessionCanvas` and `closeSessionCanvas`, a local bridge and not AHP, each behind `_assertCanvasesEnabled`
  - https://github.com/microsoft/vscode/blob/e646868227c/src/vs/platform/agentHost/node/agentService.ts#L9191-L9206 - a subscribe to a gone canvas is `NotFound`, "Canvas is no longer available"
  - https://github.com/microsoft/vscode/blob/e646868227c/src/vs/platform/agentHost/node/copilot/copilotAgentSession.ts#L4187-L4320 - the Copilot projection: list as `undefined` when empty, one resource per `instanceId`, a cap of 8, and only http(s) sources
---

## Goal

A plugin can show a canvas on a chat.
The plugin opens it with a live web URL, changes it, and closes it, through calls on its `PluginHost`.
ahpd serves the AHP canvas channel, so ahpw and ahpapp get `ChatState.canvases` and one `ahp-canvas:` channel for each canvas.
Any plugin can use the calls.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -i canvas packages/*/src` - only `canvasesEnabled` in `vscoderootconfig.ts`. ahpd sends no canvas action.
- `rg -i canvas packages/sdk/test` - the handshake test of the silence, the two `chat/canvasesChanged` reducer fixtures, and `canvasesEnabled` in the root config test.
- `rg -i canvas .project/plans` - `host/47` left canvas out on 2026-10-03, and `host/88` says a later plan must decide the version gate for real.
- `rg -i canvas /github/ahpw/src /github/ahpapp/src` - both clients offer `0.10.0`, and their reducers fold the canvas actions. Neither draws a canvas. ahpw draws `canvasesEnabled` in its features section.
- `rg "disable|unload" packages/server/src/plugins*.ts` - a plugin is loaded and unloaded while the daemon runs, and an unload runs the plugin's closers.
- VS Code `1.143.1` (`e646868227c`): canvases come only from the Copilot SDK, and open and close go over a local bridge.
  The window draws a canvas only for the local `copilotcli` provider.

### Runtime path

```
plugin: openCanvas(chat, state) -> host canvases: resource = ahp-canvas:/<base64url(chat)>/<uuid>
  -> dispatch(resource, canvas/stateChanged) -> dispatch(chat, chat/canvasesChanged)
  -> seenBy: only a connection at 0.10.0 or later -> client subscribes to resource -> snapshot CanvasState
plugin: updateCanvas(resource, state) -> canvas/stateChanged
plugin: closeCanvas(resource) or the chat goes -> chat/canvasesChanged without it -> subscribe answers -32008
```

### Gaps

- The connection does not keep its agreed version, so `seenBy` cannot hold an action back from an older connection.
- No store holds the canvases of a chat, and the chat snapshot has no `canvases`.
- `snapshotOf` and `channelKind` do not know `ahp-canvas:`.
- `PluginHost` has no call to open, update or close a canvas.
- Nothing reads `canvasesEnabled`.

## Answers

| What | Source | Task |
| --- | --- | --- |
| ahpd serves the AHP canvas channel, for ahpw and ahpapp | Softov, 2026-10-22, "canvas I was referring to was the canvas channel" | 02 |
| Any plugin can open a canvas on a chat through the SDK, with open, update and close calls on the plugin host | Softov, 2026-10-22, the plugin host gets the calls, the Copilot SDK plugin uses them, and so can any other plugin or a plugin route as the URL | 03 |
| The calls are `openCanvas(chat, state)`, `updateCanvas(resource, state)` and `closeCanvas(resource)` | `(defaulted: upstream's openSessionCanvas and closeSessionCanvas, without "Session", because the plugin names the chat)` | 03 |
| The plugin gives the whole `CanvasState`, with its own `instanceId` and `extensionId` | https://github.com/microsoft/agent-host-protocol/blob/main/types/channels-canvas/state.ts | 03 |
| `openCanvas` with an `instanceId` that is open on that chat replaces its state and answers the same resource | https://github.com/microsoft/vscode/blob/e646868227c/src/vs/platform/agentHost/node/copilot/copilotAgentSession.ts#L4247-L4285 | 02, 03 |
| Only the plugin that opened a canvas can update or close it | `(defaulted: a registered scheme is one plugin's, and a canvas is the same)` | 03 |
| `openCanvas` refuses a chat that the host does not have live | `(defaulted: a cold chat has no running provider to draw the canvas)` | 03 |
| `closeCanvas` of a resource that is gone does nothing | `(defaulted: upstream closeCanvas converges when two closes meet)` | 03 |
| A `url` that is not absolute http(s) with an authority is refused with an error | `(defaulted: the plugin host refuses a bad argument by name; upstream drops the url with a warning)` | 03 |
| The resource is `ahp-canvas:/<base64url(chat)>/<uuid>`, with a new uuid for each lifetime | https://github.com/microsoft/vscode/blob/e646868227c/src/vs/platform/agentHost/common/canvasUri.ts | 02 |
| `canvas/stateChanged` goes out before the chat lists the resource | https://github.com/microsoft/vscode/blob/e646868227c/src/vs/platform/agentHost/node/agentHostStateManager.ts#L1077-L1100 | 02 |
| `chat/canvasesChanged` carries the whole list, and `undefined` when the list is empty | https://github.com/microsoft/vscode/blob/e646868227c/src/vs/platform/agentHost/node/copilot/copilotAgentSession.ts#L4187-L4196 | 02 |
| A subscribe to a canvas that is gone answers `-32008`, "Canvas is no longer available" | https://github.com/microsoft/vscode/blob/e646868227c/src/vs/platform/agentHost/node/agentService.ts#L9191-L9206 | 02 |
| A canvas closes when its chat closes, is removed or moves to another session | https://github.com/microsoft/vscode/blob/e646868227c/src/vs/platform/agentHost/node/agentHostStateManager.ts#L1094-L1100 | 02 |
| Canvases live in memory only and are gone after a restart | https://github.com/microsoft/agent-host-protocol/blob/main/types/channels-canvas/state.ts | 02 |
| The host never writes a canvas `url` to its log | https://github.com/microsoft/agent-host-protocol/blob/main/types/channels-canvas/state.ts | 02, 03 |
| A plugin clears `url` itself when its source stops, and the host closes a plugin's canvases when it unloads the plugin | [code://packages/server/src/pluginschannel.ts#L11-L13](../../../../packages/server/src/pluginschannel.ts#L11-L13) | 03 |
| The host has no cap on canvases for each chat | `(defaulted: upstream caps at 8 in the Copilot provider, so a plugin decides its own cap)` | 02 |
| A subscribe to a canvas is read as a subscribe to its chat's session | `(defaulted: an annotations channel is read as its session's through baseOf, and the canvas URI names its chat)` | 02 |
| The chat snapshot carries `canvases` on every version | https://github.com/microsoft/agent-host-protocol/blob/main/docs/specification/versioning.md | 02 |
| A call before a host is built throws by name | [code://packages/sdk/src/plugins/plugins.ts#L1476-L1486](../../../../packages/sdk/src/plugins/plugins.ts#L1476-L1486) | 03 |
| Canvas actions go to every connection at `0.10.0` or later, and an older connection gets none, as the version registry says | Softov, 2026-10-22, this replaces the `host/88` rule | 01 |
| Any plugin can open a canvas on any live chat | Softov, 2026-10-22 | 03 |
| `canvasesEnabled` gates the calls, as upstream: it is off by default, and `openCanvas` throws until it is on | Softov, 2026-10-22 | 03 |
| Turning `canvasesEnabled` off leaves the open canvases open | `(defaulted: upstream asserts the key only when a call is made)` | 03 |
| A canvas `url` is any absolute http(s) URL, and the plugin makes sure that a remote client can reach it | Softov, 2026-10-22 | 03 |
| A client cannot close a canvas, as upstream, and only the plugin closes it | Softov, 2026-10-22 | 03 |
| ahpw and ahpapp get no work in this plan | `(defaulted: clients draw only what the host sends, and drawing a canvas is client work)` | - |
| The Pass 7 canvas box in `UPSTREAM.md` closes with this plan | `(defaulted: the box names this work)` | 04 |

## Proposed architecture

- **Data flow** - a plugin call reaches a host-wide canvas store, and the store dispatches `canvas/stateChanged` on the canvas and `chat/canvasesChanged` on the chat.
- **Event flow** - `seenBy` holds back an action that `isActionKnownToVersion` says the connection's agreed version does not know.
- **State flow** - the store maps each resource to its chat, its plugin and its `CanvasState`. The chat snapshot lays the chat's list over the backend's state, as `movable` is laid.
- **Layer responsibilities** - sdk `host/canvases.ts`: the store and the pruning · sdk `host.ts`: the version gate · sdk `plugins/plugins.ts`: the three calls · docs: the plugin API.
- **Source-of-truth files** - `packages/sdk/src/host/canvases.ts`, created by task 02.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - An older connection gets no canvas action](task-01-an-older-connection-gets-no-canvas-action.md) | done | - |
| [02 - The host keeps the canvases of a chat](task-02-the-host-keeps-the-canvases-of-a-chat.md) | done | 01 |
| [03 - A plugin opens, updates and closes a canvas](task-03-a-plugin-opens-a-canvas.md) | done | 02 |
| [04 - The docs say how a plugin opens a canvas](task-04-the-docs-say-how-a-plugin-opens-a-canvas.md) | done | 03 |

## Risks and tradeoffs

- The version gate goes past upstream, which sends canvas actions to every connection. The specification requires the gate, and upstream does not filter by version at all.
- The gate reverses the `host/47` row "ahpd keeps no per-connection filter", and the `host/88` silence test goes.
- A VS Code window that agrees on `0.10.0` gets canvas actions. Its reducers fold them, and it draws canvases only for its local `copilotcli` provider.
- The canvas channel is experimental, so a later protocol release can change its shape.
- A canvas URL on the daemon's loopback is not reachable from a remote client. The plugin that opens the canvas owns this, for example through its own route.
- A plugin route has no credential in front of it, so a canvas URL that carries a secret puts that secret in every subscriber's state.

## Resume state

- **Done so far:** planned 2026-10-22, and the open questions answered the same day. The refs were checked against main `343ca825` on 2026-10-28. Plugins now load and unload while the daemon runs, so task 03 closes a plugin's canvases at unload. VS Code main `2398c3f7c7c` was checked on 2026-10-28: the canvas URI, the state manager, the `NotFound` answer and the Copilot projection rules are the same. Task 01 is implemented: each connection keeps its agreed version, and `seenBy` holds back a protocol action the version does not know. Task 02 is implemented: `host/canvases.ts` holds the store, the snapshot answers an `ahp-canvas:` channel, the chat lists its canvases, and the move, the removed chat and `teardown` forget them. Task 03 is implemented: a plugin opens, draws and closes a canvas through its `PluginHost`, the store refuses a bad state or a bad `url`, and the first open adds the closer that takes a plugin's canvases away when it unloads. Task 04 is implemented: the plugin docs, the AHP canvas section, the chat's canvases and the upstream box all say what the code does.
- **Next action:** none. The plan is built, and `implemented.md` says what exists.
- **Open questions:** none. Softov answered all five on 2026-10-22.
- **Watch out for:** `respelledIn` rewrites every `resource` and `url` value for a connection that knows a session by another name, and the canvas resource holds the chat in base64url. Both come out unchanged, and the last case of `host-canvases.test.ts` proves it.
  A canvas is served by its own branch in `snapshotOf`, before the session lookup, so an `ahp-canvas:` channel answers from the canvas store alone.

## Final verification checklist

- [ ] A plugin opens a canvas on a live chat, and a `1.0.0` client subscribed to the chat gets `canvas/stateChanged` and then `chat/canvasesChanged`.
- [ ] A `0.9.0` client on the same chat gets neither action, and a replay to it holds neither.
- [ ] A subscribe to the canvas answers its `CanvasState`; after `closeCanvas` it answers `-32008`.
- [ ] A chat that closes, is removed or moves takes its canvases with it.
- [ ] A plugin that unloads takes its canvases with it.
- [ ] No canvas `url` is in the host log.
- [ ] The plugin API docs list the three calls.
