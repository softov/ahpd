---
title: The root config declares the artifact prompt switch and deferred title generation
status: done
depends: []
layer: packages/sdk
refs:
  - code://packages/sdk/src/host.ts#L3352-L3369 - `rootConfig` and `ROOT_CONFIG_SCHEMA`, which this task extends
  - code://packages/sdk/src/host.ts#L3370-L3384 - `rootState`, which reports the schema and the values
  - code://packages/sdk/src/host.ts#L5713-L5739 - the `root/configChanged` handler, which keeps a key whether or not it is understood
  - code://test/conformance.test.ts#L438-L467 - the root config test, where the schema's keys are asserted
  - file:///github/externals/vscode/src/vs/platform/agentHost/common/agentHostSchema.ts#L549-L575 - the root keys the reference declares
  - file:///github/externals/vscode/src/vs/platform/agentHost/common/artifactToolsConfiguration.ts#L24-L30 - the window setting mapped onto `artifactToolsCompactPrompts`
---

## Objective

`ROOT_CONFIG_SCHEMA` declares `artifactToolsCompactPrompts` and `deferredTitleGeneration` as booleans, and a client that pushes either reads it back in `config.values`.

## Files

- `UPDATE: packages/sdk/src/host.ts:3352-3369` - add the two properties to `ROOT_CONFIG_SCHEMA`, each with a title and a description, and update the comment that says there is one key.
- `UPDATE: test/conformance.test.ts:438-467` - the root config test asserts the three declared keys.

## Steps

1. Add `artifactToolsCompactPrompts` to `ROOT_CONFIG_SCHEMA.properties`: `type: 'boolean'`, a title, and a description saying it selects the short artifact instruction and changes no availability.
2. Add `deferredTitleGeneration` beside it: `type: 'boolean'`, a title, and a description saying it gives a session a deferred title strategy and shapes `rename_chat`.
3. Change the schema's comment from one key to the keys this host honours, keeping the sentence that a key here is a promise that pushing it changes something.
4. Leave `rootState` as it is: it already reports the whole schema and every value a client pushed.

## Validation

- `test/conformance.test.ts`: `keeps what a client pushes on the root channel, and says it back` asserts `Object.keys(snapshot.state.config.schema.properties)` contains `defaultShell`, `artifactToolsCompactPrompts` and `deferredTitleGeneration`.
- `pnpm vitest run test/conformance.test.ts` green.
- `pnpm test`, `pnpm typecheck` and `pnpm boundary` green.

## Resume

