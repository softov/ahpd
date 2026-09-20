---
title: The daemon names plugins in configuration and on the command line
status: todo
depends:
  - task-01-contract-and-fold.md
layer: packages/server
refs:
  - code://packages/server/src/config.ts#L8-L41 - `Config`, which gains `plugins`
  - code://packages/server/src/main.ts#L135-L211 - `parse()`, which gains the two cases and the file merge under them
  - code://packages/server/src/main.ts#L30-L82 - `Options`, which gains the fields
  - code://packages/server/src/main.ts#L84-L133 - `USAGE`, which documents them
  - code://packages/server/src/main.ts#L193-L210 - the `paths` merge, which is the shape a command line `--plugin` follows: it replaces the file's list rather than adding to it
  - code://packages/plugin/src/types/plugin.ts#L33-L40 - `PluginSpec`, which is the field's type
  - code://.project/decisions/plugin-manifest-is-package-json.md - the two spec forms a person may write
---

## Objective

`config.json` may carry a `plugins` array and the command line may carry `--plugin <spec>` repeated or `--no-plugins`, with a command line `--plugin` replacing the file's list the way `--path` does, so a person can install a plugin, name it, and switch it off for one run without editing ahpd.

## Files

- `UPDATE: packages/server/src/config.ts:8-L41` - add `plugins?: PluginSpec[]` with a comment saying every entry is a package or a path, and that naming one runs it.
- `UPDATE: packages/server/src/main.ts:30-82` - add `plugins: PluginSpec[]` and `noPlugins: boolean` to `Options`.
- `UPDATE: packages/server/src/main.ts:135-L211` - the `--plugin` and `--no-plugins` cases, and the config merge.
- `UPDATE: packages/server/src/main.ts:84-133` - `USAGE`: the two flags and the sentence that naming a plugin runs its code in this process.
- `CREATE: test/plugin-spec.test.ts` - a test of the spec normaliser the parse cases use.

## Steps

1. Add `plugins?: PluginSpec[]` to `Config` in `config.ts`, importing the type from `@ahpd/plugin`, and write the comment that this is the one key whose value is code and that the file is therefore owner-readable for the same reason the token file is.
2. Add `plugins: PluginSpec[] = []` and `noPlugins = false` to the `Options` literal in `parse()`, and document both on the interface.
3. Add `case '--plugin'` pushing `String(argv[++i])` and `case '--no-plugins'` setting `noPlugins = true`, matching the existing switch.
4. Extract a small `asSpec(value: unknown): PluginSpec | undefined` that accepts a non-empty string or an object with a string `name` and an optional `options` object and `enabled` boolean, and refuses anything else with a message naming the entry, so a typo in the configuration is refused at startup rather than at load.
5. Merge the file under the flags in the block at the end of `parse()`: when no `--plugin` was given and `--no-plugins` was not, take `file.plugins` through `asSpec`; a `--plugin` on the command line replaces the list rather than adding to it, the way `--path` does, and `--no-plugins` with a `--plugin` is refused as contradictory the way the token flags already are.
6. Add the flags to `USAGE` with the sentence that a plugin is code in this process with this process's permissions, and that installing one is the trust decision.
7. Leave the `start` verb alone: it re-runs `main.ts` with the rest of the line, so the child parses the same flags and the same file, which is how `--port` and `--automations` already reach it.

## Validation

- `test/plugin-spec.test.ts`, over the normaliser only, since the daemon domain records that no test starts `main.ts`:
  - a non-empty string passes through.
  - an object with a string `name` passes, with and without `options` and `enabled`.
  - an empty string, a number, an object with no `name` and an object whose `name` is a number each return nothing.
- By hand: `ahpd config` prints the `plugins` array it read, and a file with a malformed entry refuses to start with a message naming the entry.
- By hand: `ahpd --plugin x --no-plugins` refuses as contradictory; `ahpd --plugin x` with a file naming `y` loads only `x`.
- `pnpm test` green, `pnpm typecheck` green.

## Resume

Empty until started.
