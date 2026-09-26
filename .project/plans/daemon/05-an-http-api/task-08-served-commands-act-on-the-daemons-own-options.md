---
title: Served commands act on the daemon's own options, and no request ends the daemon
status: todo
depends: [task-07-the-listener-survives-a-malformed-request.md]
layer: "server"
refs:
  - "[decisions/the-http-api-acts-on-the-daemons-own-options.md](../../../decisions/the-http-api-acts-on-the-daemons-own-options.md) - what this task applies"
  - "[code://packages/server/src/commands/options.ts#L78-L93](../../../../packages/server/src/commands/options.ts#L78-L93) - `stop` and `refuse`"
  - "[code://packages/server/src/commands/options.ts#L272-L343](../../../../packages/server/src/commands/options.ts#L272-L343) - `optionsFrom`, which calls `stop` at lines 281, 295 and 301"
  - "[code://packages/server/src/commands/run.ts#L122-L159](../../../../packages/server/src/commands/run.ts#L122-L159) - the daemon's `users` directory and the `apiHandler` it is mounted with"
---

## Objective

A served command reads the options the daemon was started with and never the request's idea of them: its configuration file, its user directory, its plugins and its directories.
`configFile`, `users`, `plugins` and `paths` are absent from the served declarations and so from the manifest.
`status` over HTTP describes the process answering, and no request reaches `process.exit`.

## Files

- `UPDATE: packages/server/src/commands/registry.ts:129-142` - `cliRegistry` is what is served today; the served registry is built with the daemon's options instead.
- `UPDATE: packages/server/src/http.ts:34-62` - `ApiOptions` and `apiHandler` take what the served commands need from the running daemon.
- `UPDATE: packages/server/src/commands/run.ts:154-159` - passes the daemon's `Options`, its configuration path, the `users` directory built at line 122, and the listener's facts once it is bound (the registry is built before `listen`, so they are read lazily).
- `UPDATE: packages/server/src/commands/status.ts:16-55` - over HTTP answers from the running daemon (pid, URL, paths, automations, start time) with no `daemon.json`; today it answers 500 for a daemon run in the foreground.
- `UPDATE: packages/server/src/commands/plugin.ts:20-36` - `plugin list` calls `optionsFrom(context.input)`, whose `stop` exits the daemon on `?noPlugins=true&plugins=x&plugins=y` (verified: exit 2), and reads any `configFile` it is given.
- `UPDATE: packages/server/src/commands/config.ts:68-85` - reads the daemon's own configuration file.
- `UPDATE: packages/server/src/commands/user.ts:28-44` - `people` opens the users file the input names; over HTTP it uses the daemon's directory, and a daemon with none answers 400.
- `UPDATE: packages/server/src/commands/user.ts:115-121` and `status.ts:25-34` - the comments explain the branch by telling what used to happen; they document what the branch is.
- `UPDATE: test/server-http.test.ts:45-54, 68-113, 131-140` - the fixture writes the daemon's configuration to the default XDG path and writes a fake `daemon.json` with `recordFor`, which is what let a daemon on another file and a foreground daemon pass.

## Steps

1. Build the served registry from the same `declare*` functions with the daemon's facts provided as a capability, and without the four path fields in the served commands' input (decision `the-http-api-acts-on-the-daemons-own-options`).
2. On the remote surface, `status`, `config`, `plugin list` and the `user` verbs read that capability and never call `optionsFrom`, `loadConfig()` or `fileUsers` themselves.
3. No served path calls `stop`: `optionsFrom` is terminal-only, and any refusal on the remote surface goes through `refuse`, which throws.
4. The terminal's own commands keep every field and flag they have now.

## Validation

- `test/server-http.test.ts`, the fixture: the daemon runs on a `--config-file` outside the XDG default and with `--users <file>` that the file does not name, and no case writes `daemon.json`.
- `GET /api/status` with the deployment token answers 200 with the daemon's own pid; today 500.
- `GET /api/plugin/list?noPlugins=true&plugins=x&plugins=y` with the deployment token answers and the daemon keeps running; today it exits 2.
- `GET /api/plugin/list?configFile=<a file holding TOPSECRET>` answers without `TOPSECRET` in the body; today the 500 quotes it.
- `POST /api/user/add/mallory` with `{ "users": "<tmp path>" }` as root writes no file at that path, and adds `mallory` to the daemon's own users file; today it writes the tmp path.
- `GET /api/user/list` as root lists the people in the `--users` file; today 400 "No user file".
- `GET /api/config` answers the `--config-file` contents; today the default path's.
- `GET /api/cli-manifest` lists no `configFile`, `users`, `plugins` or `paths` field on any command.

## Resume
