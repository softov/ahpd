---
title: Served commands act on the daemon's own options, and no request ends the daemon
status: done
depends: [task-07-the-listener-survives-a-malformed-request.md]
layer: "server"
refs:
  - "[code://packages/server/src/commands/served.ts#L38-L57](../../../../packages/server/src/commands/served.ts#L38-L57) - `ServedFacts` and `servedRegistry`, the declarations built against the daemon"
  - "[code://packages/server/src/commands/options.ts#L243-L260](../../../../packages/server/src/commands/options.ts#L243-L260) - `servedUserFields` and `servedPluginWriteFields`, without the daemon's own paths"
  - "[code://packages/server/src/commands/status.ts#L24-L27](../../../../packages/server/src/commands/status.ts#L24-L27) - served, the process answering is the one described"
  - "[code://packages/server/src/commands/plugin.ts#L28-L33](../../../../packages/server/src/commands/plugin.ts#L28-L33) and [#L77-L78](../../../../packages/server/src/commands/plugin.ts#L77-L78) - served, the list and the file edited are the daemon's"
  - "[code://packages/server/src/commands/user.ts#L57-L64](../../../../packages/server/src/commands/user.ts#L57-L64) - served, `people` opens the daemon's directory"
  - "[code://packages/server/src/commands/config.ts#L61-L64](../../../../packages/server/src/commands/config.ts#L61-L64) - served, the daemon's own file is read"
  - "[code://packages/server/src/commands/run.ts#L200-L223](../../../../packages/server/src/commands/run.ts#L200-L223) - the facts the daemon hands it, read per request"
  - "[code://packages/server/src/commands/scopes.ts#L34-L45](../../../../packages/server/src/commands/scopes.ts#L34-L45) - the hook both registries share"
  - "[code://packages/server/test/server-http.test.ts#L290-L301](../../../../packages/server/test/server-http.test.ts#L290-L301) and [#L606-L716](../../../../packages/server/test/server-http.test.ts#L606-L716) - the fixture and the served-options cases"
---

## Objective

A served command reads the options the daemon was started with and never the request's idea of them: its configuration file, its user directory, its plugins and its directories.
`configFile`, `users`, `plugins` and `paths` are absent from the served declarations and so from the manifest.
`status` over HTTP describes the process answering, and no request reaches `process.exit`.

## Files

- `CREATE: packages/server/src/commands/served.ts` - `ServedFacts`, `ServedRunning` and `servedRegistry`, so the served declarations can be built without a cycle through `registry.ts`.
- `CREATE: packages/server/src/commands/scopes.ts` - `checkScopes`, the hook both registries are built with.
- `UPDATE: packages/server/src/commands/registry.ts` - imports the shared hook; its own `cliRegistry` and `localRegistry` are unchanged for the terminal.
- `UPDATE: packages/server/src/commands/options.ts:243-260` - the served `user` and plugin-write fields.
- `UPDATE: packages/server/src/commands/status.ts, config.ts, user.ts, plugin.ts` - an optional `ServedFacts`; served, each reads the daemon and declares no path field.
- `UPDATE: packages/server/src/commands/run.ts:200-223, 231` - builds the facts and mounts `servedRegistry(facts)`.
- `UPDATE: packages/server/src/daemon.ts` - `statusLine` takes the three fields it prints.
- `UPDATE: packages/server/test/server-http.test.ts:53-72, 290-301, 606-716` - the fixture and the cases.

## Steps

1. Build the served registry from the same `declare*` functions with the daemon's facts provided as a capability, and without the four path fields in the served commands' input .
2. On the remote surface, `status`, `config`, `plugin list` and the `user` verbs read that capability and never call `optionsFrom`, `loadConfig()` or `fileUsers` themselves.
3. No served path calls `stop`: `optionsFrom` is terminal-only, and any refusal on the remote surface goes through `refuse`, which throws.
4. The terminal's own commands keep every field and flag they have now.

## Validation

- `packages/server/test/server-http.test.ts`, the fixture: the daemon runs on a `--config-file` outside the XDG default and with `--users <file>` that the file does not name, and no case writes `daemon.json`.
- `GET /api/status` with the deployment token answers 200 with the daemon's own pid; today 500.
- `GET /api/plugin/list?noPlugins=true&plugins=x&plugins=y` with the deployment token answers and the daemon keeps running; today it exits 2.
- `GET /api/plugin/list?configFile=<a file holding TOPSECRET>` answers without `TOPSECRET` in the body; today the 500 quotes it.
- `POST /api/user/add/mallory` with `{ "users": "<tmp path>" }` as root writes no file at that path, and adds `mallory` to the daemon's own users file; today it writes the tmp path.
- `GET /api/user/list` as root lists the people in the `--users` file; today 400 "No user file".
- `GET /api/config` answers the `--config-file` contents; today the default path's.
- `GET /api/cli-manifest` lists no `configFile`, `users`, `plugins` or `paths` field on any command.

## Resume

Done.
The facts are passed by closure, not through cofold's `provide`: the same `declare*` functions take an optional `ServedFacts`, and `servedRegistry` passes the daemon's own `Options`, configuration path, `users` directory and a `running()` read at request time, because the listener is bound after the registry is built.
The four path fields are absent from the served declarations, so they are absent from the manifest: a served `status` and `config` declare no field at all, and the served `user` and plugin-write declarations keep only what is the command's own.
`checkScopes` moved to `scopes.ts` so `served.ts` can build a registry without importing `registry.ts` back.
The fixture now runs the daemon on `--config-file home/config.json` and `--users` as a flag, and writes no `daemon.json`; the `--remote` cases lost `--no-update-check`, which the served declarations no longer take.
`pnpm typecheck` green; `packages/server/test/server-http.test.ts` green, 31 cases; `server-cli` and `server-commands` green.
