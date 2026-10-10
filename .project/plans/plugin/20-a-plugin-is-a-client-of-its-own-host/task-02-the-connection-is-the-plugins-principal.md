---
title: The connection is plugin:<name>, with the grants its entry names
status: done
depends: [task-01-a-plugin-opens-a-connection.md]
layer: "sdk, server"
refs:
  - "[code://packages/sdk/src/types/plugin.ts#L66-L73](../../../../packages/sdk/src/types/plugin.ts#L66-L73) - `PluginSpec`"
  - "[code://packages/server/src/config.ts#L378-L392](../../../../packages/server/src/config.ts#L378-L392) - `asSpec`"
  - "[code://packages/server/src/plugins.ts#L684](../../../../packages/server/src/plugins.ts#L684) - where the spec reaches `pluginHost`"
  - "[code://packages/sdk/src/types/users.ts#L40-L101](../../../../packages/sdk/src/types/users.ts#L40-L101) - `Principal`"
  - "[code://packages/sdk/src/users.ts#L79](../../../../packages/sdk/src/users.ts#L79) - `holds`"
  - "[code://packages/sdk/src/host/owners.ts#L47-L51](../../../../packages/sdk/src/host/owners.ts#L47-L51) - `ownerFor`, which answers `plugin:<name>` for a plugin's principal"
  - "[code://packages/sdk/src/types/usage.ts#L19](../../../../packages/sdk/src/types/usage.ts#L19) - `Owner`, which gains the `plugin:<name>` form"
  - "[code://packages/server/src/commands/options.ts#L408-L416](../../../../packages/server/src/commands/options.ts#L408-L416) - `pluginEntry`"
  - "[code://packages/sdk/src/users.ts#L545](../../../../packages/sdk/src/users.ts#L545) - `principalOf`, how grants become `can`"
---

## Objective

A plugin's connection is served as the principal `plugin:<name>`, which can do what its configuration entry's `grants` say and nothing else.

## Files

- `UPDATE: packages/sdk/src/types/plugin.ts:66-73` - `grants?: string[]` on the object form of `PluginSpec`.
- `UPDATE: packages/server/src/config.ts:378-392` - `asSpec` keeps `grants` when it is an array of strings.
- `UPDATE: packages/server/src/commands/options.ts:408-416` - `pluginEntry` gains `grants: { type: 'array', items: { type: 'string' } }`.
- `UPDATE: packages/server/src/plugins.ts:684` - the loader checks each grant, drops one whose shape is not `<subject>:<verb>` with a line in its `problems` naming `plugins.<name>.grants`, and hands the rest to `pluginHost`.
- `UPDATE: packages/sdk/src/types/usage.ts:19` - `Owner` gains the `plugin:<name>` form.
- `UPDATE: packages/sdk/src/host/owners.ts:47-51` - `ownerFor` answers `plugin:<name>` for a plugin's principal, not `user:plugin:<name>`.
- `UPDATE: packages/sdk/src/plugins.ts` - `connect()` passes the principal to `Host.accept`.
- `UPDATE: packages/server/test/plugin-connect.test.ts` - the cases below.

## Steps

1. Build the principal with id `plugin:<name>`, no roles, no `memberships`, `primary` or `teams` (its work is charged to no team), and `can` answering from the grants with `holds` (`users.ts:79`), the matching a role's grants use. A policy matches it by its id.
2. No `grants` is an empty list, so every gated command is refused `-32009`.
3. Never pass `root`.
4. On a host with no user directory nothing is gated, as for any connection.
5. Add the `plugin:<name>` form to `Owner`, and have `ownerFor` answer it for a plugin's principal, so a plugin's sessions and usage are its own.

## Validation

- `packages/server/test/plugin-connect.test.ts`: with a directory, no `grants` is refused `createSession`; `session:write` is allowed it and refused `runAutomation`; a malformed grant is dropped and appears in the loader's `problems` naming `plugins.<name>.grants`; a session the plugin creates is owned by `plugin:<name>`, and its usage is recorded under that owner.
- `pnpm test`, `pnpm typecheck` green.

## Resume

- The principal is built in `pluginHost` where the plugin's name is already in hand: `Object.freeze({ id: \`plugin:${by}\`, roles: Object.freeze([]), can: (grant) => holds(new Set(options.grants ?? []), grant) })`. No `memberships`, no `primary`, no `teams`, so `scopeFor` answers nothing, its work has no team pool, and a policy matches it by its id. Frozen where it is built, as every principal this host serves is.
- `by` is the module's exported `name` and not the spec the operator typed, so a plugin loaded from `./packages/server/test/fixtures/plugin-connect` arrives as `plugin:plugin-connect`. That is the id the gate's refusals name and the owner its work is recorded under.
- `plugin:<name>` is added to `Owner` in `types/usage.ts`, and `ownerOfPrincipal(id)` is new in `values.ts`: it answers the id itself when it starts with `plugin:` and `user:<id>` otherwise. `ownerFor` and the `principals.set` in `Host.accept` both go through it, so a plugin owns its sessions and its usage and is found again by the owner a later read names.
- `PluginSpec` gains `grants?: string[]` - a `string` rather than a `Grant` because it is read off a file that holds whatever was typed. `asSpec` refuses the whole entry when `grants` is not an array of strings, which is a schema failure the person is told about by line; `pluginEntry` in `commands/options.ts` carries the same shape.
- The loader checks each grant with `grantProblem` and drops one that names nothing, pushing `plugin <name>: plugins.<name>.grants: <problem>` into its `problems` and keeping the list beside it. An `Array.isArray` guard sits in front, because a string read as a list would report one line per character.
- `HostRecordingOptions.grants` is how the checked list reaches `pluginHost`; the SDK trusts the loader's validation, because only the loader can name `plugins.<name>.grants`. `pluginHost` adds the option only when the list is non-empty, so a plugin with none is the one the type documents.
- `grantProblem` is exported from `packages/sdk/src/index.ts`. `isGrant` and `holds` are deliberately not: a plugin author has no use for either, and the export map has a single `.` entry, so nothing can reach them deeply.
- `packages/server/test/plugin-connect.test.ts` gains four cases, all against a host with a users directory so the gate is on: no `grants` refuses `createSession` with `-32009` and `plugin:plugin-connect may not session:create here`; `session:write` allows the session and refuses `runAutomation` with `plugin:plugin-connect may not automation:run here`; `['session:write', 'session:launch']` drops the second with one line naming `plugins.plugin-connect.grants` and still opens the session; and a session the plugin creates is owned by `plugin:plugin-connect`, with the usage record carrying `owner` and `pools` of the same.
- The metering case needed a backend of its own. The `echo` agent runs a whole turn inside `begin` and reports nothing, so a usage report emitted after it returned arrives for a turn the meter has already written and let go of. The test's `reporting()` agent emits `chat/turnStarted`, `chat/usage` and `chat/turnComplete` itself, which is what a harness does.
- **Departure 1.** `HostRecordingOptions.grants` is not in this task's Files list.
- **Departure 2.** `grantProblem` is a new export from `packages/sdk/src/index.ts`; the plan named no SDK index change, and the loader cannot check a grant without it.
- **Departure 3.** `packages/server/test/plugin-spec.test.ts` (two cases: a list of grants is kept; an entry whose grants are not a list of strings goes) and `packages/server/test/config-check.test.ts` (one case: `plugins.grants must be a list of text`, and `plugins.grants must be text` for an item) are not in the Files list. Both are the `asSpec` and schema halves of the `grants` field, which this task adds.
- **Departure 4.** A grant of the wrong *shape* is refused by `asSpec` as part of the entry, and only a well-shaped grant that names no operation is dropped by the loader. The plan's Step for the loader says "checks each grant, drops one whose shape is not `<subject>:<verb>`"; the file's shape is the schema's business and the grammar's is the loader's, so the two are split rather than both reported by the loader.
- Verified: `packages/server/test/plugin-connect.test.ts` 7 cases, `plugin-spec.test.ts` 6 and `config-check.test.ts` 50 green on their own; then the full gates - `pnpm install`, `node tools/schema.mjs`, `pnpm build`, `pnpm typecheck`, `pnpm boundary` and `npx vitest run --maxWorkers=2 --testTimeout=10000` (272 files, 4842 tests) - green.
