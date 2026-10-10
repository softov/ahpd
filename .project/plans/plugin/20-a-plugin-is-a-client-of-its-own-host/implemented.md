---
title: A plugin is a client of its own host, as a principal of its own - implemented
date: 2026-10-10
refs:
  - git://0a5046e
  - "[code://packages/sdk/src/pair.ts](../../../../packages/sdk/src/pair.ts)"
  - "[code://packages/sdk/src/plugins.ts](../../../../packages/sdk/src/plugins.ts)"
  - "[code://packages/server/src/plugins.ts](../../../../packages/server/src/plugins.ts)"
  - "[code://packages/server/src/commands/run.ts](../../../../packages/server/src/commands/run.ts)"
---

A plugin that has to act rather than contribute calls `host.connect()` and gets an AHP client of its own host: the raw peer, served by the same door a socket is, as the principal `plugin:<name>` with the grants its configuration entry names and nothing otherwise. A session it opens is its own - it lands in the catalogue owned by `plugin:<name>`, and the work done in it is charged to that one pool.

## What was built

- [`code://packages/sdk/src/pair.ts`](../../../../packages/sdk/src/pair.ts) - new. `createPair()` answers the host's `Peer` and the plugin's end of one in-memory pair, `served(connection)` and `close()`; one frame per turn of the loop, and both ends closing together.
- [`code://packages/sdk/src/types/plugin.ts`](../../../../packages/sdk/src/types/plugin.ts) - `PluginPeer`, `PluginConnects`, `PluginHost.connect()`, `Contribution.connects`, and `PluginSpec.grants`.
- [`code://packages/sdk/src/plugins.ts`](../../../../packages/sdk/src/plugins.ts) - `connect()` on the plugin host, the frozen `plugin:<name>` principal, the open pairs it closes, `HostRecordingOptions.grants`, and the fold's `pluginConnects`.
- [`code://packages/sdk/src/types/host.ts`](../../../../packages/sdk/src/types/host.ts) - `HostOptions.pluginConnects`.
- [`code://packages/sdk/src/types/usage.ts`](../../../../packages/sdk/src/types/usage.ts) and [`code://packages/sdk/src/values.ts`](../../../../packages/sdk/src/values.ts) - the `plugin:<name>` form of `Owner` and `ownerOfPrincipal`, which answers it for a principal with the `plugin` field and `user:<id>` for anyone else.
- [`code://packages/sdk/src/types/users.ts`](../../../../packages/sdk/src/types/users.ts) - `Principal.plugin`, set only on the principal a plugin's connection is served as.
- [`code://packages/sdk/src/host/owners.ts`](../../../../packages/sdk/src/host/owners.ts) and [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts) - `ownerFor` and the `principals` key both go through `ownerOfPrincipal`.
- [`code://packages/server/src/config.ts`](../../../../packages/server/src/config.ts) and [`code://packages/server/src/commands/options.ts`](../../../../packages/server/src/commands/options.ts) - `asSpec` keeps a list of strings and refuses the entry otherwise; `pluginEntry` carries the shape.
- [`code://packages/server/src/plugins.ts`](../../../../packages/server/src/plugins.ts) - the loader checks each grant with `grantProblem`, drops one that names nothing with a line naming `plugins.<name>.grants`, and hands the rest on.
- [`code://packages/server/src/commands/run.ts`](../../../../packages/server/src/commands/run.ts) - the built host is bound onto every plugin's entry, and closed on `down` after `stopping`.
- [`code://packages/sdk/src/index.ts`](../../../../packages/sdk/src/index.ts) - `grantProblem` exported.
- `docs/PLUGINS.md` - `### A plugin is a client of its own host`, and `grants` in the configuration entry.

## Verified

- `packages/server/test/plugin-connect.test.ts` (new, 7 cases) with the fixture `packages/server/test/fixtures/plugin-connect`: a plugin connects at `listening` and a watching client sees its turn; connecting during `apply` is refused with a sentence; the daemon closes the connection at `stopping` and the plugin sees it go.
- The same file's second half runs against a host with a users directory: no `grants` is refused `-32009` on `createSession`; `session:write` opens the session and is refused `automation:run`; `session:launch` is dropped beside a kept `session:write`, with one line naming `plugins.plugin-connect.grants`; and a plugin's session and usage record are owned by `plugin:plugin-connect`, pooled to itself alone.
- `packages/server/test/plugin-spec.test.ts` (6) and `packages/server/test/config-check.test.ts` (50) cover the `grants` shape at the spec and the schema.
- `pnpm install`, `node tools/schema.mjs`, `pnpm build`, `pnpm typecheck`, `pnpm boundary` and `npx vitest run --maxWorkers=2 --testTimeout=10000` all green on 2026-10-10, the suite at 272 files and 4842 tests.
- The suite rewrites `packages/sdk/test/fixtures/wire.jsonl` (the endpoint line and the `ahpd.` `_meta` lines), as it does on every run; it is modified in the working tree.

## Departures from the plan

- `HostOptions.pluginConnects` and `Contribution.connects` are not in task 01's Files list. The built host has to reach the plugin through the options, because the daemon is the only thing that can set it.
- `grantProblem` is a new export from `packages/sdk/src/index.ts`, which no task named; the loader cannot check a grant without it.
- `packages/server/test/plugin-spec.test.ts` and `packages/server/test/config-check.test.ts` gained the `grants` cases. Neither is in task 02's Files list; both are the `asSpec` and schema halves of the field it adds.
- A grant of the wrong shape is refused by `asSpec` as part of the entry, and only a well-shaped grant that names no operation is dropped by the loader - the plan's task 02 Step gives both to the loader.
- Task 03's Step names decision `a-grant-is-a-subject-and-a-verb`, which is `superseded`; the docs link the accepted `a-grant-names-an-operation-and-read-and-write-are-its-groups`, which the file already cites for the same grammar.
- Both of task 03's ref line ranges had moved, including at the plan's own `revalidated: 2026-10-04`. The `connect()` section follows its ref's note and sits beside `### Read-only context`; the `grants` prose sits in `## Naming a plugin`, which is the configuration entry its note names.
- Review: the plugin's owner is read from `Principal.plugin`, not from the id's `plugin:` prefix. A user id may be any string - decision [a plugin's principal is marked](../../../decisions/a-plugin-principal-is-marked-not-read-from-its-id.md). `packages/sdk/test/values.test.ts` covers both.
- Review: a pair that closes removes itself from the plugin's open list. Before, a plugin held every pair it opened until the daemon stopped.
- Task 03's Validation is a hand run of the example against a daemon, and none was made. The commands it shows are the ones `plugin-connect.test.ts` exercises end to end.

## Left for later

- Acting as a person, as a grant a plugin must hold - the plan's second table names it with no task.
