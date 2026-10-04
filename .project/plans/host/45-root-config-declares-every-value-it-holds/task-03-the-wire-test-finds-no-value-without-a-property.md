---
title: The wire test finds no root config value without a property
status: todo
depends: [task-01-the-root-config-declares-the-keys-vscode-pushes.md, task-02-a-pushed-key-nobody-declares-is-refused.md, task-04-the-compact-wording-and-the-title-keys-go-as-upstream.md]
layer: "sdk test"
refs:
  - "[code://packages/sdk/test/wire.test.ts](../../../../packages/sdk/test/wire.test.ts) - the recorded host, whose traffic host/43 p1 task 03 widens to the daemon's root config"
  - "[code://tools/wire.mjs](../../../../tools/wire.mjs) - the frame checker host/43 p1 routes by the protocol's maps"
  - "[code://packages/sdk/test/fixtures](../../../../packages/sdk/test/fixtures) - where the connect patch is kept"
---

## Objective

The wire test's host receives the connect patch a VS Code 1.140 client sends, and the test fails when root `config.values` holds a key that root `config.schema.properties` does not.

## Files

- `CREATE: packages/sdk/test/fixtures/vscode-root-config.json` - the 43 keys of task 01 with a value of each one's declared type (upstream's default where it has one), plus `activeAgentTitleGeneration`, `artifactToolsCompactPrompts`, `deferredTitleGeneration` and `vscode.automationMigration`, which an older client still sends. No value is copied from anybody's machine.
- `UPDATE: packages/sdk/test/wire.test.ts` - dispatch the fixture as one `root/configChanged` on the root channel after the handshake, then take a root snapshot.

## Steps

1. After host/43 p1 task 03, add the dispatch to the recorded traffic, so its frames go through the same schema check as every other.
2. Assert over the root snapshot: every key of `config.values` is a key of `config.schema.properties`.
3. Assert the echo carries the 43 keys and not the four old ones.
4. Leave the `RootState /config/schema` lines in host/43 p1's `KNOWN` list alone; they belong to p3, and the 43 properties added here must not add a line to it.

## Validation

- `pnpm exec vitest run packages/sdk/test/wire.test.ts` passes.
- The test fails when `nonsense: 1` is added to the fixture and task 02's refusal is commented out, and fails when one entry is deleted from `vscodeRootProperties`.
- `pnpm test` passes.

## Resume
