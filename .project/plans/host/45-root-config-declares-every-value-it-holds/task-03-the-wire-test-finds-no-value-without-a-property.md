---
title: The wire test finds no root config value without a property
status: done
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

Built on 2026-10-09, uncommitted on `build/agents/db49ec10`.

- `packages/sdk/test/fixtures/vscode-root-config.json` holds the 43 keys of task 01 in its table order. Each carries a value of the type its property declares, and upstream's default where it declares one. Then come the four keys a client older than 1.140 still sends: `activeAgentTitleGeneration`, `artifactToolsCompactPrompts`, `deferredTitleGeneration` and `vscode.automationMigration`. No value came off anybody's machine. The addresses are `example.test`, the trusted folder is `/home/example/project`, and the two objects are upstream's own resolved defaults.
- `wire.test.ts` dispatches the fixture as one `root/configChanged` on `ahp-root://`. It goes right after the first session is created, and before the root subscribe that reads back. Its frames then go through the same strict schema as every other frame in the capture. `node tools/schema.mjs` has to have run. The file's own `stale()` guard regenerates it when it has not.
- Four assertions, all on the frames this run produced. The echo of the action is exactly the 43 declared keys, and there is one echo. Every key of root `config.values` is a key of `config.schema.properties`, which is the assertion the task exists for. It holds for the daemon's own keys too, the plugin's `plugins.<name>` among them. The 43 are all held, and none of the four old keys is.
- The capture writes `fixtures/wire.jsonl` as it always does, so the committed fixture regenerates with this action in it. The plan's plan-level instruction restores it with `git checkout --` after the gates. That command is denied to this session, and the file is dirty at the end of the run, so it is named for Softov.
- Negative checks, both run and then reverted. Deleting `disableRepoInfoTelemetry` from `vscodeRootProperties` fails the test, with the echo one key short. Adding `nonsense: 1` to the fixture with task 02's rejection temporarily disabled fails it too. The echo and `values` both carry a value with no property. Neither source edit is in the tree now, and the wire test passes at 43 keys.
- `RootState /config/schema` has no line in host/43 p1's `KNOWN` list, which is still empty, so step 4 holds. The 43 properties added no finding. The generated `ahp.strict.schema.json` closes `config.properties` per key and leaves `config.values` open. That is what makes the second assertion check the host rather than the protocol.

## Open questions

None.
