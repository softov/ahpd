---
title: The checks say what is wrong
status: todo
depends: []
layer: server
refs:
  - "[code://packages/server/src/found.ts#L109-L135](../../../../packages/server/src/found.ts#L109-L135) - `nodeRuns` and `findRuntimes`, for the Runtime check"
  - "[code://packages/server/src/found.ts#L205-L245](../../../../packages/server/src/found.ts#L205-L245) - `configuredAgents` and `findAgents`, for the Agents check"
  - "[code://packages/server/src/commands/configure.ts#L292](../../../../packages/server/src/commands/configure.ts#L292) - how `configure` reads the agent records for `configuredAgents`"
  - "[code://packages/server/src/config.ts#L711](../../../../packages/server/src/config.ts#L711) - `loadConfig`, for the Config check"
  - "[code://packages/server/src/daemon.ts#L210-L231](../../../../packages/server/src/daemon.ts#L210-L231) - `running`, for the Daemon check"
  - "[code://packages/server/src/service.ts#L137](../../../../packages/server/src/service.ts#L137) - `serviceOn` and `installFile`, for the Service check"
  - "[code://packages/server/src/plugins.ts#L2180](../../../../packages/server/src/plugins.ts#L2180) - `describePlugin`, for the Plugins check"
  - "[code://packages/server/src/update.ts#L165](../../../../packages/server/src/update.ts#L165) - `updateLine`, for the Update check"
---

## Objective

`packages/server/src/doctor.ts` has one function for each check, and each function gives `ok`, `warn` or `fail` with one line and a fix.
`checks` runs them in the plan's order, each with a limit of 5 s.

## Files

- `CREATE: packages/server/src/doctor.ts` - the `Check` type, the seven checks and `checks`, which runs them in order.
- `CREATE: packages/server/test/doctor.test.ts` - each check with each of its results, and the limit.

## Steps

1. Declare `Check` as `{ name, result: 'ok' | 'warn' | 'fail', line, fix? }`, with `fix` on every `warn` and `fail`.
2. Write the Runtime check with `nodeRuns` for this process and `findRuntimes` for the other runtimes.
3. Write the Config check with `loadConfig`, and give `fail` with the file and the parse error when it throws.
4. Write the Daemon check with `running`, and give `warn` with `ahpd start` when it answers nothing.
5. Open a `WebSocket` at the record's `connectUrl`, and give `ok` with the record's `url` when it opens.
6. Give `fail` with `ahpd restart` when the socket does not open within 5 s, and close it in each case.
7. Write the Service check with `serviceOn` and `installFile`, and give `warn` with `ahpd service install` when the file is absent.
8. Give no Service line when `serviceOn` answers nothing.
9. Write the Plugins check with `describePlugin` for each plugin.
10. Give `fail` with its `problem` for a plugin that does not load.
11. Write the Agents check with `findAgents` and `configuredAgents`, from the same records that `configure` reads.
12. Give `fail` with the install line for a configured agent that is not on PATH.
13. Give `warn` with `ahpd configure` for an agent on PATH that is not configured.
14. Write the Update check with `updateLine`, as `warn` with `ahpd update` as the fix.
15. Write `checks`, which runs each check under a limit of 5 s.
16. Give `fail` for a check that does not finish within its limit.
17. Put no token, `connectUrl` or plugin secret into a line, a fix or a field.

## Validation

- `packages/server/test/doctor.test.ts` holds a case for each result of each check.
- The cases use a fake runner, a fake PATH and XDG temp dirs.
- A case holds a socket that never opens, with fake timers.
- That case checks that the Daemon check is `fail` after 5 s.
- A case holds a record with a token, and checks that no field of any check holds the token.
- `pnpm -s typecheck` and `pnpm -s exec vitest run packages/server/test/doctor.test.ts` pass.

## Resume
