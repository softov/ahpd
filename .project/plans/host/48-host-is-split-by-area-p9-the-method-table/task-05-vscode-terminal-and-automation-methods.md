---
title: The vscode, diagnostic, terminal and automation methods move to their files
status: implemented
depends: [task-01-the-classification-test-reads-every-file.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L9296-L9533](../../../../packages/sdk/src/host.ts#L9296-L9533) - the `vscode/*` worktree, artifact and debug-log methods, `shutdown`, `getNetworkDiagnosticsInfo`, `getManagedSettingsDiagnostics`, `diagnosticsFetch`"
  - "[code://packages/sdk/src/host.ts#L9534-L9647](../../../../packages/sdk/src/host.ts#L9534-L9647) - `vscode/devContainers/*`"
  - "[code://packages/sdk/src/host.ts#L7698-L7761](../../../../packages/sdk/src/host.ts#L7698-L7761) - `alive`, `containers`, `CONTAINER_TAIL`, `containerAsk`, `namedContainer`"
  - "[code://packages/sdk/src/host.ts#L124-L154](../../../../packages/sdk/src/host.ts#L124-L154) - `PROXY_ENV`, `PROBE_TIMEOUT`, `MAX_BODY`, `resolved`"
  - "[code://packages/sdk/src/host.ts#L2700-L2718](../../../../packages/sdk/src/host.ts#L2700-L2718) - `stateFileOf`, read by the two `vscode/*` session file methods only"
  - "[code://packages/sdk/src/host.ts#L8416-L8493](../../../../packages/sdk/src/host.ts#L8416-L8493) - `createTerminal`, `disposeTerminal`"
  - "[code://packages/sdk/src/host.ts#L8513-L8573](../../../../packages/sdk/src/host.ts#L8513-L8573) - `listAutomationTriggerDefinitions`, `runAutomation`; `fetchAutomationRuns` at 8707"
---

## Objective

`host/vscodemethods.ts` returns the reference client's methods and the diagnostics, `host/terminals.ts` adds the terminal methods and `host/automations.ts` the automation methods, unchanged; `handlers` is only spreads.

## Files

- `CREATE: packages/sdk/src/host/vscodemethods.ts` - `PROXY_ENV`, `PROBE_TIMEOUT`, `MAX_BODY`, `resolved`, `stateFileOf`, `containers`, `CONTAINER_TAIL`, `containerAsk`, `namedContainer`, every `vscode/*` method, `shutdown`, the three diagnostics methods.
- `UPDATE: packages/sdk/src/host/terminals.ts` - a per-connection table with `createTerminal` and `disposeTerminal`.
- `UPDATE: packages/sdk/src/host/automations.ts` - a per-connection table with `listAutomationTriggerDefinitions`, `runAutomation`, `fetchAutomationRuns`.
- `UPDATE: packages/sdk/src/host.ts` - those removed; `logs` is on the context; `alive` becomes `conn.alive` on the `ConnectionContext`.

## Steps

1. Move each method and declaration with its comment, unchanged but for indentation.
2. `containers` is per connection, so it goes on the `ConnectionContext`; `handle`'s close reads it there.
3. After this task the `handlers` literal in `accept` holds only spreads, in today's method order.

## Validation

- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass; `test/diagnostics.test.ts`, `test/container-relay.test.ts`, `test/containers.test.ts`, `test/worktrees.test.ts`, `test/automations.test.ts`, `test/pty.test.ts` cover it, and `users-gate.test.ts` still finds the number task 01 recorded.
- `wc -l packages/sdk/src/host.ts` recorded.

## Resume

Built 2026-10-04. `packages/sdk/src/host/vscodemethods.ts` (494 lines) holds `PROXY_ENV`, `PROBE_TIMEOUT`, `MAX_BODY`, `resolved`, `DETACHED_GRACE`, `CONTAINER_TAIL`, `stateFileOf`, `containerAsk`, `namedContainer` and the seventeen methods. `host/terminals.ts` grew `createTerminalMethods` and `host/automations.ts` grew `createAutomationMethods`, each returning its own table.

`host.ts` is 2,768 lines and its `handlers` literal is six spreads and nothing else:

```
...handshake, ...methods, ...sessionMethods, ...terminalMethods, ...automationMethods, ...vscode
```

Three things the Files section did not name moved with their readers, and each is recorded here rather than left to be found later:

- `DETACHED_GRACE` and `CONTAINER_TAIL` are module constants now. Each has exactly one reader, and that reader moved; leaving either in `host.ts` would have left a constant nothing in the file used.
- `logs` and `detached` became `HostContext` fields. Both are per host, both are read only from `vscodemethods.ts`, and `logs` had to be declared above the `ctx` literal to be one.
- `stateFileOf` reads nothing per connection, so it is a plain `const` inside `createVscodeMethods` rather than a field on either context. `createAutomationMethods` takes only `HostContext` for the same reason - none of the three methods reads anything of the connection's.

Step 2 is `conn.alive` and `conn.containers`, both on the `ConnectionContext` and both set in the literal `accept` builds. `handle`'s close writes `conn.alive = false` and drains `conn.containers`; `vscode/devContainers/connect` reads both.

`BANG` left `host.ts` here: task 02 moved its only reader, `initialize`, and the import was not dropped then.

Validation: `pnpm exec tsc --noEmit`, `pnpm boundary` and `pnpm test` all pass, 176 files and 2,707 tests. `users-gate.test.ts` still finds the 45 task 01 recorded.

One flake, twice, unrelated to this plan: `packages/computer/test/computer-disposable.test.ts` failed its `afterEach` with `ENOTEMPTY` on `rmSync` of its own scratch directory, then passed on a re-run of that file alone and on two subsequent full runs. Nothing in `packages/computer` is touched by this plan.
