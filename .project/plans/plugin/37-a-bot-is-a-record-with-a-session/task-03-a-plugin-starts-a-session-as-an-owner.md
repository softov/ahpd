---
title: A plugin starts a session as an owner
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/automations.ts#L638-L700](../../../../packages/sdk/src/host/automations.ts#L638-L700) - the steps an automation's run takes to start a session"
  - "[code://packages/sdk/src/types/plugin.ts#L317](../../../../packages/sdk/src/types/plugin.ts#L317) - `PluginHost`"
  - "[code://packages/sdk/src/plugins.ts#L610-L617](../../../../packages/sdk/src/plugins.ts#L610-L617) - how a `PluginHost` method is made"
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

