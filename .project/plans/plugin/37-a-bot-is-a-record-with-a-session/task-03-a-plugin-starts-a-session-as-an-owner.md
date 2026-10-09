---
title: A plugin starts a session as an owner
status: implemented
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/automations.ts#L580-L648](../../../../packages/sdk/src/host/automations.ts#L580-L648) - `beginSession`, the steps an automation's run takes to start a session"
  - "[code://packages/sdk/src/host/automations.ts#L755-L764](../../../../packages/sdk/src/host/automations.ts#L755-L764) - `beginPluginSession`, which asks `session:create` first"
  - "[code://packages/sdk/src/types/plugin.ts#L265](../../../../packages/sdk/src/types/plugin.ts#L265) - `PluginHost`"
  - "[code://packages/sdk/src/plugins.ts#L599-L606](../../../../packages/sdk/src/plugins.ts#L599-L606) - how a `PluginHost` method is made, and where a plugin's request is checked"
---

## Objective

`PluginHost.startSession({ owner, provider, config, workingDirectory, prompt })` starts a session as `owner` and returns its URI.
It takes the steps of an automation's run: isolation, the owner's grants and policies, the computer the config names, and the first turn.

## Files

- `UPDATE: packages/sdk/src/host/automations.ts:638-700` - the steps move into one function that the run calls.
- `UPDATE: packages/sdk/src/types/plugin.ts` - `startSession` on `PluginHost`, with a one-line comment per field.
- `UPDATE: packages/sdk/src/plugins.ts` - the method, bound to the host.
- `CREATE: packages/sdk/test/plugin-start-session.test.ts` - the cases below.

## Steps

1. Write the tests.
2. Move the steps into one function and call it from the run; the automation tests pass unchanged.
3. Add `startSession` to `PluginHost` and bind it.

## Validation

- A test: a session that starts for `user:soft` has `user:soft` as its owner and shows in their list.
- A test: an owner without `session:create` gets the same refusal a client gets.
- A test: a `config.computer` needs `computer:write`, as in an automation's run.
- The automation tests in `packages/sdk/test` pass unchanged.
- `pnpm build`, `pnpm typecheck` and `npx vitest run packages/sdk` pass.

## Resume

Implemented 2026-10-08. The steps both roads take are `beginSession`. `beginAutomation` keeps the pinned-session branch and calls it. `beginPluginSession` asks `session:create` of the owner first, and answers with the refusal a client gets at the door, word for word. `session:create` is asked only on the plugin's road, because an automation's run is not gated by it. `automation-wake.test.ts` has an owner holding `session:read` alone still getting a run.

Three files beyond the ones this task lists were needed to carry the method to a live host, on the pattern `PluginTriggers.deliver` set. `types/plugin.ts` carries `SessionRequest`, `PluginStarts` and `Contribution.starts`, and `types/host.ts` carries `pluginStarts`. `createAutomations` fills each plugin's `start`, so a test that builds a host through `foldHostOptions` and `createHost` reaches the same road a daemon does. `validate.ts`'s `checkSessionRequest` is the boundary where a plugin's untrusted request becomes the host's own `StartSession`. Nothing downstream needs a translation.

