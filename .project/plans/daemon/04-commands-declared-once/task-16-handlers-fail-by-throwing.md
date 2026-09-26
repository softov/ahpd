---
title: The command handlers fail by throwing a cofold error, and never touch the process
status: todo
depends: [task-04-docs-and-dependencies.md]
layer: "server"
refs:
  - "[code://packages/server/src/commands/options.ts#L78-L81](../../../../packages/server/src/commands/options.ts#L78-L81) - `stop`, which writes to stderr and calls `process.exit(2)`"
  - "[code://packages/server/src/commands/status.ts#L25-L39](../../../../packages/server/src/commands/status.ts#L25-L39) - a plain `Error` over HTTP, `process.exit(1)` on the terminal"
  - "[code://packages/server/src/commands/stop.ts#L22-L27](../../../../packages/server/src/commands/stop.ts#L22-L27) - `None running.` on stdout, then `process.exit(1)`"
  - "[code://packages/server/src/commands/start.ts#L43-L46](../../../../packages/server/src/commands/start.ts#L43-L46) - `context.error`, then `process.exit(1)`"
  - "[code://packages/server/src/commands/user.ts#L41](../../../../packages/server/src/commands/user.ts#L41) - `onProblem` on the daemon's own stderr"
  - "[code://packages/server/src/commands/user.ts#L115-L121](../../../../packages/server/src/commands/user.ts#L115-L121) - `No user called` on stdout, then `process.exit(1)`"
  - "[code://test/server-cli.test.ts#L195-L203](../../../../test/server-cli.test.ts#L195-L203) - the pinned `status` case with nothing running"
  - file:///github/cofold/packages/commands/src/errors.ts - `CofoldError`, `ArgumentError` and the exit code of each kind
---

## Objective

No handler under `packages/server/src/commands/` calls `process.exit` or writes to the process's streams, and every exit code a person or a script sees is the one it is today.
Over HTTP, each of those failures is answered with its sentence and a status, never "Failed".

## Files

- `UPDATE: packages/server/src/commands/options.ts:78-81` - `stop` throws `ArgumentError(message)` (exit 2); `refuse` keeps its shape and needs no surface branch, since both surfaces now throw.
- `UPDATE: packages/server/src/commands/status.ts:25-39` - nothing running throws `new CofoldError('conflict', 'None running.')` on every surface; `--json` keeps `{"running":false}` by throwing after `context.write` of the JSON.
- `UPDATE: packages/server/src/commands/stop.ts:22-27` - the same, with `{"stopped":false}`.
- `UPDATE: packages/server/src/commands/start.ts:43-46` - throws `new CofoldError('conflict', 'Could not start it: ...')`.
- `UPDATE: packages/server/src/commands/user.ts:41` - `onProblem` goes to `context.error`; `people` takes the context.
- `UPDATE: packages/server/src/commands/user.ts:115-121` - throws `new CofoldError('conflict', 'No user called <id>.')`, with no surface branch.
- `UPDATE: test/server-cli.test.ts:195-203` and the other cases that pin these sentences - re-pinned to stderr with the `ahpd: ` prefix and the same exit code.
- `UPDATE: test/server-http.test.ts` - the remote cases below.

## Steps

1. Replace each call above with a thrown `CofoldError` that keeps the exit code (`ArgumentError` for 2, kind `conflict` for 1); this is how every cofold handler fails, and `runEntry` and `serve()` already turn it into the terminal's line and the HTTP status.
2. Drop the `context.surface === 'remote'` branches that only existed to avoid `process.exit`, and the comments that explained them.
3. `run.ts` is the daemon and keeps its process calls; `registry.ts`'s `warn` is the registry's configuration and stays.
4. `rg -n "process\.(exit|stdout|stderr)" packages/server/src/commands/ --glob '!run.ts'` finds only `registry.ts`'s `warn`.
5. [daemon/05 task 08](../05-an-http-api/task-08-served-commands-act-on-the-daemons-own-options.md) changes what `status`, `user` and `optionsFrom` read over HTTP; whichever lands second rebases on the other.

## Validation

- `test/server-cli.test.ts`: `ahpd status` with nothing running exits 1 with `ahpd: None running.` on stderr; `ahpd stop` the same; `ahpd user rm nobody --users <file>` exits 1 with `ahpd: No user called nobody.` on stderr; a `stop` refusal still exits 2.
- `test/server-http.test.ts`: `GET /api/status` on a daemon with no record answers a 4xx with the sentence, not 500 "Failed"; today the body is `{ "message": "Failed" }`.
- `test/server-http.test.ts`: `POST /api/user/rm/nobody` answers the sentence and the daemon keeps running.
- The `rg` of step 4.
- `pnpm typecheck` green.

## Resume
