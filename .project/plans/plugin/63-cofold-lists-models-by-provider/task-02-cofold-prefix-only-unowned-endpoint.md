---
title: The cofold prefix names only an unowned endpoint
status: done
depends: [task-01-list-every-provider-under-its-id.md]
layer: "agent-cofold"
refs:
  - "[code://packages/agent-cofold/src/agent.ts#L245-L256](../../../../packages/agent-cofold/src/agent.ts#L245-L256) - the `ownRef` check and the strict errors"
  - "[code://packages/agent-cofold/test/agent-cofold-models.test.ts#L203-L216](../../../../packages/agent-cofold/test/agent-cofold-models.test.ts#L203-L216) - the test of an endpoint no file provider owns"
---

## Objective

A `cofold/<id>` reference no longer resolves to a file provider. The `cofold` prefix stays only for an explicit `baseUrl` or for the local endpoint when the file has no provider.

## Files

- `UPDATE: packages/agent-cofold/src/agent.ts` - remove `ownRef`, and accept the `own` prefix only where no file provider owns the endpoint.
- `UPDATE: packages/agent-cofold/test/agent-cofold-models.test.ts` - tests for the refused and the accepted `cofold/` references.
- `UPDATE: packages/agent-cofold/test/agent-cofold-config.test.ts` - change any test that expects `cofold/<id>` to reach a file provider.

## Steps

1. Remove the `ownRef` constant and its comment from `connectionOf`.
2. In strict mode, accept a reference under `own` only with an explicit `baseUrl` or with no file provider.
3. Keep the error that names the configured providers for every other reference without a matching provider.
4. Keep the test at line 203, so an explicit `baseUrl` still lists and resolves `cofold/qwen/qwen3-8b`.
5. Add a test that `cofold/<id>` fails with a file provider and no explicit `baseUrl`, and that the error names `open_router`.
6. Add a test that `cofold/<id>` resolves to the local endpoint when the file has no provider.
7. Update the doc comment on `Connection.prefix` so that it says when the prefix is `own`.

## Validation

- `rg -n "ownRef" packages/agent-cofold/src` finds nothing.
- `pnpm -s vitest run packages/agent-cofold` passes.
- The gate passes: `pnpm -s typecheck && pnpm -s build && pnpm -s boundary && pnpm -s test`.

## Resume

- **Done so far:** `ownRef` is removed.
  In strict mode a reference under this backend's own id is accepted only with an explicit `baseUrl` or with no file provider.
  Any other unmatched reference keeps the error that names the configured providers.
  The test of an explicit `baseUrl` still lists and resolves `cofold/qwen/qwen3-8b`.
  New tests cover the refused `cofold/<id>` with a file provider and the accepted one with no provider.
  The doc comment on `Connection.prefix` says when the prefix is this backend's own id.
  `rg -n "ownRef" packages/agent-cofold/src` finds nothing.
  The full `packages/agent-cofold` suite passes, and `pnpm -s typecheck` passes.
- **Next action:** step 1.
- **Files:** none yet.
- **Open questions:** none.
- **Departures:** none.
- **Watch out for:** none.
