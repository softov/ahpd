---
title: AHP calls the update
status: done
depends:
  - task-03-update-installs-moves-plugins-and-restarts.md
layer: server
refs:
  - "[code://packages/sdk/src/types/plugin.ts#L333-L364](../../../../packages/sdk/src/types/plugin.ts#L333-L364) - `PluginMethod`"
  - "[code://packages/server/src/commands/run.ts#L928-L932](../../../../packages/server/src/commands/run.ts#L928-L932) - `base.methods`, where the usage methods are served"
  - "[code://packages/server/src/commands/scopes.ts#L35-L45](../../../../packages/server/src/commands/scopes.ts#L35-L45) - the deployment token check over HTTP"
---

## Objective

A client sends `x-ahpd/update` with `{version?, check?, force?}` and gets the same answer as `POST /api/update`.

## Files

- `UPDATE: packages/server/src/commands/update.ts` - `updateMethod()`, a `PluginMethod` that calls the same steps as the command.
- `UPDATE: packages/server/src/commands/run.ts:928-932` - add `x-ahpd/update` to `base.methods`, by `ahpd`.
- `CREATE: packages/server/test/host-update-method.test.ts` - the method through a scenario client.

## Steps

1. Write the tests first.
2. Give the method the grant `config:write`.
3. Refuse with an `RpcError` any owner that does not start with `root:`, with the words `deploymentOnly` gives.
4. Call the steps of task 03 with the params, in `oneAtATime`.
5. Answer the same result as the command, and restart after the answer.
6. Set this task and the plan row to `implemented`.

## Validation

- A test: the method refuses a signed-in person, and the refusal names the deployment token.
- A test: the root connection gets `{current, latest, may}` for `check`.
- A test: the root connection gets `{from, to, restarting: true}`, and the fake restart runs.
- `pnpm -s build`, `pnpm -s typecheck` and the server vitest suite pass.

## Resume

Done 2026-10-19. Every step is built, and every case the Validation names passes. Not reviewed.

`updateMethod()` in `commands/update.ts` is the `PluginMethod` for `x-ahpd/update`, granted `config:write`. It refuses a caller that carries a `reader`, or an owner that names somebody other than `root:`, with an `RpcError` carrying the words `deploymentOnly` gives. The root connection calls `runUpdate()` in `oneAtATime`. It is the same plan, plugin check, install, plugin move and successor check the command runs, and it answers the same value. The restart is `served.restart`, which defers itself until the answer has gone, as it does for the API. `run.ts` serves the method from `base.methods` by `ahpd`, beside the usage methods.

Departures:
- `commands/scopes.ts` exports `deploymentOnly`, which was private, so the method says the same sentence the API does.
- The body of `declareUpdate` was factored into `runUpdate()`, so the two surfaces are one path. The command catches and answers with `conflict`. The method answers `-32603` for a failed step and `-32009` for the owner refusal, the code `admit` and the usage methods use.
- The method also refuses a request that carries a `reader`, which is a person or a plugin. The owner alone would not refuse a plugin's owner when a host has no users directory and no owner to name. A daemon with no users directory has no owner to name at all, so its connection, which is the host itself, is let in.
- The params are read as the command's own input is: a string `version` and `check` or `force` that is `true`. No shape refusal is added, because the sdk does not export `INVALID_PARAMS` to the server.

The four new cases in `host-update-method.test.ts` pass, through a host in this process with a users file. A person who holds `config:write` is refused, the root connection gets the check, and the root connection gets the update and the daemon's own restart. A failed npm answers `-32603` and asks for no restart. The whole server suite passes, 1220 tests in 60 files. Build, typecheck and the schema are clean.
