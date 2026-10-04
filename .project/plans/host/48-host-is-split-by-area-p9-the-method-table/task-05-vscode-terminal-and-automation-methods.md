---
title: The vscode, diagnostic, terminal and automation methods move to their files
status: todo
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
