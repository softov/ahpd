---
title: A plugin opens, updates and closes a canvas
status: done
depends:
  - task-02-the-host-keeps-the-canvases-of-a-chat.md
layer: "sdk"
refs:
  - "[code://packages/sdk/src/plugins/plugins.ts#L1570-L1579](../../../../packages/sdk/src/plugins/plugins.ts#L1570-L1579) - `registerClose`, which adds a closer that runs when the plugin unloads"
  - "[code://packages/server/src/plugins.ts#L2011-L2030](../../../../packages/server/src/plugins.ts#L2011-L2030) - `unload`, which runs the closers of a plugin while the daemon runs"
  - "[code://packages/sdk/src/types/plugin.ts#L943](../../../../packages/sdk/src/types/plugin.ts#L943) - `sessionOwner`, a late-bound call with its comment"
  - "[code://packages/sdk/src/types/plugin.ts#L1081-L1096](../../../../packages/sdk/src/types/plugin.ts#L1081-L1096) - `planChanged` and `sessionMetaChanged`, the calls to put the new ones beside"
  - "[code://packages/sdk/src/plugins/plugins.ts#L1476-L1486](../../../../packages/sdk/src/plugins/plugins.ts#L1476-L1486) - `planChanged`, which throws by name until a host fills it in"
  - "[code://packages/sdk/src/host/facts.ts#L610-L620](../../../../packages/sdk/src/host/facts.ts#L610-L620) - the host fills a late-bound call in after the fold"
  - "[code://packages/sdk/src/host/trust.ts#L172](../../../../packages/sdk/src/host/trust.ts#L172) - a root key read from `rootConfig`"
  - "[code://packages/sdk/src/vscoderootconfig.ts#L206-L211](../../../../packages/sdk/src/vscoderootconfig.ts#L206-L211) - `canvasesEnabled` and its comment"
  - https://github.com/microsoft/vscode/blob/e646868227c/src/vs/platform/agentHost/node/agentService.ts#L6005-L6048 - `_assertCanvasesEnabled` and its message
  - https://github.com/microsoft/vscode/blob/e646868227c/src/vs/platform/agentHost/node/copilot/copilotAgentSession.ts#L4303-L4320 - `_canvasSource`, the http(s) check
---

## Objective

`PluginHost` has `openCanvas(chat, state)`, `updateCanvas(resource, state)` and `closeCanvas(resource)`.
Each call goes to the host's canvas store and refuses a bad argument by name.

## Files

- `UPDATE: packages/sdk/src/types/plugin.ts:1081-1096` - declare the three calls, with a comment on each.
- `UPDATE: packages/sdk/src/plugins/plugins.ts:1476-1486` - add the three calls beside `planChanged`, and send each to the host's store with the plugin's name.
- `UPDATE: packages/sdk/src/host/facts.ts:610-620` - fill the store in for every plugin after the fold.
- `UPDATE: packages/sdk/src/host/canvases.ts` - check the arguments, the owner and `canvasesEnabled`.
- `UPDATE: packages/sdk/src/vscoderootconfig.ts:206-211` - say that this host reads `canvasesEnabled`.
- `CREATE: packages/sdk/test/plugin-canvases.test.ts` - the three calls through a plugin.

## Steps

1. Declare `openCanvas(chat: string, state: CanvasState): string` and say that it answers the canvas resource.
2. Declare `updateCanvas(resource: string, state: CanvasState): void` and say that it replaces the state whole.
3. Declare `closeCanvas(resource: string): void` and say that a gone resource does nothing.
4. Throw by name from each call when there is no host yet, as `planChanged` does.
5. Throw `Canvases are disabled.` unless `rootConfig.canvasesEnabled` is true.
6. Refuse a chat that the host does not have live.
7. Refuse a state with no `instanceId`, `extensionId` or `canvasId`.
8. Refuse a `url` that is not absolute http(s) with an authority, and do not write the `url` in the error.
9. Refuse an update or a close from a plugin that did not open the canvas.
10. Add a closer to the plugin that closes each canvas the plugin opened.
11. Add the three calls to the list of calls in the `vscoderootconfig.ts` header comment.

## Validation

- `plugin-canvases.test.ts`: a call with no host yet throws by name.
- `plugin-canvases.test.ts`: with `canvasesEnabled` off, `openCanvas` throws the message `Canvases are disabled.`
- `plugin-canvases.test.ts`: with the key on, `openCanvas` answers an `ahp-canvas:` resource and the chat lists it.
- `plugin-canvases.test.ts`: `updateCanvas` without `url` sends a state without `url`.
- `plugin-canvases.test.ts`: a `file:` url, a relative url and a chat that is not live are each refused.
- `plugin-canvases.test.ts`: a second plugin cannot update or close the first plugin's canvas.
- `plugin-canvases.test.ts`: `closeCanvas` twice does nothing the second time.
- `plugin-canvases.test.ts`: an unload of the plugin closes its canvases, and the chat lists none.
- Run `pnpm --filter @ahpd/sdk test` and expect every case to pass.
- Run `git checkout -- packages/sdk/test/fixtures/wire.jsonl` after the run.

## Resume

- **Done so far:** built. `PluginHost` has `openCanvas(chat, state)`, `updateCanvas(resource, state)` and `closeCanvas(resource)`. Each one throws by name until a host is built over the plugin, and then calls the store with the plugin's name. `Contribution.canvases` carries the store's entry, and `foldHostOptions` passes every plugin's entry to the host as `pluginCanvases`; `wireCanvases` in `host/facts.ts` fills `open`, `update`, `close` and `closeAll` in when the store is made. The store refuses a call while `rootConfig.canvasesEnabled` is not `true`, a chat this host does not hold, a state with no instance, extension or canvas id, a `url` that is not absolute http(s) with a host, and a plugin that did not open the canvas; the sentence never repeats the `url`. The first open a plugin makes puts one closer on its contribution, and that closer calls `closeAll(by)`, which the key does not refuse. Twelve cases pass in `test/plugin-canvases.test.ts`.
- **Next action:** task 04, the docs.
- **Open questions:** none.
- **Watch out for:** the unload road is a choice the plan does not name. The daemon unloads a plugin whenever its entry changes, so a closer that refused while the key is off would leave canvases on a chat with nothing behind them; `closeAll` is the host's own road and takes the key out of it. The closer is pushed at the first open rather than at fold time, because `HostOptions.closers` carries one entry per registration and `plugins-close.test.ts` holds that a plugin which registers nothing contributes none.
  `Contribution.canvases` and the `pluginCanvases` fold entry are not in this task's Files: the fold has no field to carry a store to the host without them. `Contribution` gained a required member, so `plugin-host.test.ts` and `plugin-fold.test.ts` build `canvases: { by }` in their fixtures.
  The tests turn the key on by pushing `root/configChanged` on `ahp-root://`, because `HostOptions.rootConfig` is the daemon's port and not the record a client's push fills. That push is the host's own setting, so it needs `config:write`, and the users test names the grant.
