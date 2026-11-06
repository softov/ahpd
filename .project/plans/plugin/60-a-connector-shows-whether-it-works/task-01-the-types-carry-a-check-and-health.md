---
title: The types carry a check and health
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/types/connectors.ts#L103-L143](../../../../packages/sdk/src/types/connectors.ts#L103-L143) - `Adapter`, where `check` goes"
  - "[code://packages/sdk/src/access/vault.ts#L64-L70](../../../../packages/sdk/src/access/vault.ts#L64-L70) - `secretRef`, the single-key rule `fromEnvRef` follows"
---

## Objective

The sdk has the types the channel needs: an adapter's optional `check` and the health a row carries. It also has the environment reference, the `fromEnvRef` presets already use.

## Files

- `UPDATE: packages/sdk/src/types/connectors.ts:103-143` - add `check?` to `Adapter`, and the types `CheckResult`, `CallOutcome` and `ConnectorHealth`.
- `UPDATE: packages/sdk/src/access/vault.ts:64-70` - keep the name check on `fromEnvRef`, beside `secretRef`.
- `UPDATE: packages/sdk/src/index.ts` - export the new types. `fromEnvRef` is exported already.
- `UPDATE: packages/sdk/test/` - cases for `fromEnvRef`, in the test file that covers `secretRef`.

## Steps

1. Add `check?(connector: Connector): Promise<CheckResult>` to `Adapter`, with a doc comment that says when the host calls it.
2. Define `CheckResult` as `{ result: 'ok' | 'denied' | 'unreachable' | 'failed'; message?: string }`.
3. Define `CallOutcome` as `{ at: string; ok: boolean; status?: number; error?: string }`, with `at` as an ISO time.
4. Define `ConnectorHealth` as `{ check?: CheckResult & { at: string }; lastCall?: CallOutcome; lastFailure?: CallOutcome }`.
5. Use `fromEnvRef`, the reader of `{ "fromEnv": "<NAME>" }` a preset's `env` already goes through, as the environment reference.
6. Accept only a name that matches `^[A-Za-z_][A-Za-z0-9_]*$` in `fromEnvRef`, if its callers still pass their tests with it.
7. Export the new types from the sdk root.
8. Add `fromEnvRef` cases for a good name, a bad name, an extra key and a value that is no object.

## Validation

- The new `fromEnvRef` cases pass, and so do the suites of its callers, `agent-acp` and `agent-claude`.
- `pnpm -s typecheck && pnpm -s build && pnpm -s boundary` passes.

## Resume

- **Done so far:** `Adapter` has an optional `check(connector)`, documented as the call the host makes after an open and again on demand. `types/connectors.ts` defines `CheckResult`, `CallOutcome` and `ConnectorHealth`. The environment reference is `fromEnvRef`, the `{ "fromEnv": "<NAME>" }` reader a preset's `env` already uses, and it now accepts only a name matching `^[A-Za-z_][A-Za-z0-9_]*$`. The sdk root exports the three types, and `types/index.ts` passes them on. `vault.test.ts` has a `fromEnvRef` group for a good name, a bad name, an extra key and a value that is no object.
- **Next action:** [task-02-a-host-secret-can-name-an-env-variable.md](task-02-a-host-secret-can-name-an-env-variable.md).
- **Files:** `packages/sdk/src/types/connectors.ts`, `packages/sdk/src/access/vault.ts`, `packages/sdk/src/index.ts`, `packages/sdk/src/types/index.ts`, `packages/sdk/test/vault.test.ts`, this task file, the plan and the index. The session cannot commit, so they are left in the worktree.
- **Open questions:** none.
- **Departures:** the first build added an `envRef` reader for `{ "$env": "<NAME>" }`, beside `fromEnvRef`. Softov's review of 2026-10-23 settled on one form, the one presets use. `envRef` and its `EnvRef` type were removed, and the name check moved onto `fromEnvRef`.
- **Watch out for:** `secretRef` and `fromEnvRef` both demand exactly one key, so an extra key makes the value a plain value of its own. A reader that means to see one must not accept the other. The name check on `fromEnvRef` is shared with `agent-acp` and `agent-claude`. A preset option that named a variable with a dash would now read as a plain value.
