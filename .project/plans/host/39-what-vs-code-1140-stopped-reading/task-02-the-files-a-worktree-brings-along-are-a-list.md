---
title: The files a worktree brings along are a list, and a string still reads
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L4152-L4171](../../../../packages/sdk/src/host.ts#L4152-L4171) - the `worktreeIncludeFiles` schema, a comma-separated `string` today"
  - "[code://packages/sdk/src/host.ts#L4091-L4105](../../../../packages/sdk/src/host.ts#L4091-L4105) - `isolating`'s `defaults`, where `worktreeIncludeFiles: ''` is offered"
  - "[code://packages/sdk/src/host.ts#L4994-L5008](../../../../packages/sdk/src/host.ts#L4994-L5008) - the reader in `isolated`, which narrows the value where it is used"
  - "[code://packages/sdk/src/host.ts#L4607-L4612](../../../../packages/sdk/src/host.ts#L4607-L4612) - `mineOf`, which keeps only a value that is a string, and says so on the session"
  - "[code://packages/sdk/src/host.ts#L4214-L4267](../../../../packages/sdk/src/host.ts#L4214-L4267) - `mergedConfig` and `hostSchema`, the two places this host's own values are typed `Record<string, string>`"
  - "[code://packages/sdk/src/host.ts#L9846-L9893](../../../../packages/sdk/src/host.ts#L9846-L9893) - the `session/configChanged` handler, where a non-string value is refused as `takes a string`"
  - "[code://packages/sdk/src/configvalues.ts#L30-L49](../../../../packages/sdk/src/configvalues.ts#L30-L49) - `accepts`, which is what a stored value is checked against and which already knows the JSON type `array`"
  - "[code://packages/sdk/src/worktrees.ts#L87-L114](../../../../packages/sdk/src/worktrees.ts#L87-L114) - `create`, whose include loop is the thing the value reaches"
  - "[code://packages/sdk/test/worktrees.test.ts#L210-L232](../../../../packages/sdk/test/worktrees.test.ts#L210-L232) - `brings along the files a checkout leaves behind`, the one case that sends the key as a string"
  - "[code://packages/sdk/test/worktrees.test.ts#L278-L306](../../../../packages/sdk/test/worktrees.test.ts#L278-L306) - the case that asserts the key is offered on a session created with no config"
  - "[code://docs/AHP.md#L689-L709](../../../../docs/AHP.md#L689-L709) - `### Worktrees the window manages`, which says what a tree is given and does not yet say what is put in it"
  - "file:///github/externals/vscode/src/vs/platform/agentHost/node/shared/worktreeIsolation.ts - both properties declared `type: 'array'` of string items with `items: { type: 'string' }`, and read at 1013-1016 as an array only"
---

## Objective

`worktreeIncludeFiles` is declared an array of string patterns, which is the shape VS Code 1.140 sends, and a comma-separated string is still read, so a client that sends the old spelling keeps its work and a client that sends the new one stops being ignored.
The key stays editable rather than `readOnly`, because a person types it here and a client only ever seeds it.

## Files

- `UPDATE: packages/sdk/src/host.ts:4152-4171` - the property: `type: 'array'`, `items: { type: 'string' }`, a description that says patterns rather than a comma-separated string, `readOnly` left off, `sessionMutable: false` kept.
- `UPDATE: packages/sdk/src/host.ts:4091-4105` - `isolating`'s `defaults`, where `worktreeIncludeFiles: ''` becomes `[]` and the return type widens off `Record<string, string>`.
- `UPDATE: packages/sdk/src/host.ts:4994-5008` - the reader in `isolated`, which takes the array as it is and splits a string the way it does today.
- `UPDATE: packages/sdk/src/host.ts:4607-4612` - `mineOf`, so a list is said back on the session rather than dropped.
- `UPDATE: packages/sdk/src/host.ts:4214-4267` - `mergedConfig` and `hostSchema`, whose `mine: Record<string, string>` becomes `Record<string, unknown>`.
- `UPDATE: packages/sdk/src/host.ts:9878-9883` - the `takes a string` refusal, so a list of patterns is a value and not a mistake.
- `UPDATE: packages/sdk/test/worktrees.test.ts:210-232` - the existing string case, kept and joined by a list case.
- `UPDATE: packages/sdk/test/worktrees.test.ts:278-306` - the case that asserts the key is offered, extended with the type and the absence of `readOnly`.
- `UPDATE: docs/AHP.md:689-709` - what a new tree is given, under `### Worktrees the window manages`.

## Steps

1. The property at 4165 becomes `type: 'array'` with `items: { type: 'string' }`, the title stays "Files to bring along", and the description says patterns in `.gitignore` syntax for git-ignored files to copy into the worktree, the way VS Code words it. `readOnly` is left off, which is the `Decisions locked in` row "It stays editable, not `readOnly` as VS Code declares it": ahpc lets a person type it, and a key marked `readOnly` is a control a client cannot open. `sessionMutable: false` stays, so it is read when the worktree is made and closed once the session has started.
2. Rewrite the comment above the property at 4152-4164. It now says the opposite of what it says today - "A string of comma-separated patterns rather than an array, because every other value in this bag is a string" - and the reason it gives for that choice is the one 1.140 stopped honouring. The load-bearing half of it, that a worktree arrives without its `.env` and without `node_modules`, is still true and stays.
3. The default becomes `[]` at 4101, which is what `accepts` calls an array-typed property's empty value, and `isolating`'s `defaults` widens from `Record<string, string>` to `Record<string, unknown>`. The other four values are still strings, and nothing reads that map as anything but a bag of values to spread into `values` at 6235 and 8868.
4. The reader in `isolated` at 4999-5000 takes both spellings: an array whose entries are strings is used as it is, with anything that is not a string filtered out, and a string is split on `,`, trimmed and emptied as the code already does. It is read here and nowhere else, which is what the comment at 4994-4998 says: a config value is `unknown` on the wire, so a key this host declared is narrowed where it is used. Both spellings narrow to the same `string[]` that `port.create` is already handed as `include`.
5. A stored string is read as the list it names. `accepts` in `configvalues.ts` checks a stored value against the declared type, so an array-typed property would refuse a session stored with `worktreeIncludeFiles: '.env'` and fall back to the default (the `is not offered; using the default` line near 4602). Before that check, convert a stored string for `worktreeIncludeFiles` into its comma-split, trimmed, non-empty list, so the session keeps its value across the upgrade. The schema stays `type: 'array'`. Test it with a store row that holds the string.
6. `mineOf` at 4608 keeps a value that is a `string[]` as well as a string.
7. `mergedConfig` and `hostSchema` take `mine: Record<string, unknown>` instead of `Record<string, string>`, and nothing else about them changes. `hostSchema` filters on `value !== undefined && value !== ''` at 4258, and an empty array is neither, which is what keeps a default of `[]` from being dropped from a property row.
8. The refusal at 9878-9883 stops being "not a string" for the two worktree pattern keys, and stays a refusal for the rest. `isolation`, `branch` and the three branch rows are still strings, and a list sent for one of them is still a mistake worth saying so about.
9. `docs/AHP.md`, `### Worktrees the window manages`: say what a new tree is given, which the section does not say at all today. `worktreeIncludeFiles` is a list of `.gitignore` patterns for the git-ignored files copied in after the checkout, a comma-separated string is read as one, and the copy is best effort - a pattern that matches nothing is the ordinary case and does not stop the session. The count of worktree properties in the `resolveSessionConfig` row at 85 is untouched by this task and changes in task 03.

## Validation

- `packages/sdk/test/worktrees.test.ts`, the case at 210 becomes two: the same session with `worktreeIncludeFiles: ['.env']` and with `worktreeIncludeFiles: '.env'`, each asserting `readFileSync(join(where, '.env'), 'utf8')` is `SECRET=1\n` and that the worktree is under `worktreesOf(project(root))`. The string case is not deleted: reading both spellings is the decision, and a test that only sends the list would pass with the string path removed.
- The same file, the case at 278 extended: `config.schema.properties.worktreeIncludeFiles` is defined, its `type` is `'array'`, and `readOnly` is `undefined`, which is the row that says a person may type it.
- A new case beside it for a value that is neither spelling - `worktreeIncludeFiles: ['.env', 7]` - where the tree is still made and the session runs, since the narrowing is where a value is used and a value from the wire is `unknown`.
- `pnpm exec vitest run packages/sdk/test/worktrees.test.ts` - the whole file, since the default of `[]` reaches every case that resolves a config.
- `pnpm test` - `tools/schema.mjs` regenerates the strict schema, and a property that no longer declares a `string` is a schema change the wire gate would notice.
- `pnpm typecheck` and `pnpm boundary`.
