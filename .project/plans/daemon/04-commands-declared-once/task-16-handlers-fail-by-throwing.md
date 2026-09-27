---
title: The command handlers fail by throwing a cofold error, and never touch the process
status: done
depends: [task-04-docs-and-dependencies.md]
layer: "server"
refs:
  - "[code://packages/server/src/commands/options.ts#L72-L91](../../../../packages/server/src/commands/options.ts#L72-L91) - `stop` and `conflict`, each throwing rather than touching the process"
  - "[code://packages/server/src/commands/status.ts#L28-L33](../../../../packages/server/src/commands/status.ts#L28-L33) - nothing running throws on every surface"
  - "[code://packages/server/src/commands/stop.ts#L22-L27](../../../../packages/server/src/commands/stop.ts#L22-L27) - the same, keeping `{\"stopped\":false}` for `--json`"
  - "[code://packages/server/src/commands/start.ts#L118-L120](../../../../packages/server/src/commands/start.ts#L118-L120) - a failed start throws rather than ending the process"
  - "[code://packages/server/src/commands/user.ts#L43-L80](../../../../packages/server/src/commands/user.ts#L43-L80) - `people` writes what the directory complained about through the context"
  - "[code://packages/server/src/commands/user.ts#L160](../../../../packages/server/src/commands/user.ts#L160) - no user called, thrown"
  - "[code://packages/server/test/server-cli.test.ts#L377-L384](../../../../packages/server/test/server-cli.test.ts#L377-L384) - the re-pinned `None running.` case"
  - "[code://packages/server/test/server-cli.test.ts#L560-L562](../../../../packages/server/test/server-cli.test.ts#L560-L562) - the re-pinned `No user called` case"
  - "[code://packages/server/test/server-http.test.ts#L596-L603](../../../../packages/server/test/server-http.test.ts#L596-L603) and [#L697-L704](../../../../packages/server/test/server-http.test.ts#L697-L704) - the served sentences"
  - file:///github/cofold/packages/commands/src/errors.ts - `CofoldError`, `ArgumentError` and the exit code of each kind
---

## Objective

No handler under `packages/server/src/commands/` calls `process.exit` or writes to the process's streams, and every exit code a person or a script sees is the one it is today.
Over HTTP, each of those failures is answered with its sentence and a status, never "Failed".

## Files

- `UPDATE: packages/server/src/commands/options.ts:72-91` - `stop` throws `ArgumentError(message)` (exit 2); `refuse` has no surface branch, since both surfaces now throw; `conflict` throws the kind whose exit code is 1.
- `UPDATE: packages/server/src/commands/status.ts:28-33` - nothing running throws on every surface; `--json` keeps `{"running":false}` by throwing after `context.write` of the JSON.
- `UPDATE: packages/server/src/commands/stop.ts:22-27` - the same, with `{"stopped":false}`.
- `UPDATE: packages/server/src/commands/start.ts:118-120` - throws a conflict carrying `Could not start it: ...`.
- `UPDATE: packages/server/src/commands/user.ts:43-80` - `onProblem` goes to `context.error`; `people` takes the context.
- `UPDATE: packages/server/src/commands/user.ts:160` - throws a conflict carrying `No user called <id>.`, with no surface branch.
- `UPDATE: packages/server/test/server-cli.test.ts:377-384, 560-562` and the other cases that pin these sentences - re-pinned to stderr with the `ahpd: ` prefix and the same exit code.
- `UPDATE: packages/server/test/server-http.test.ts:596-603, 697-704` - the remote cases below.

## Steps

1. Replace each call above with a thrown `CofoldError` that keeps the exit code (`ArgumentError` for 2, kind `conflict` for 1); this is how every cofold handler fails, and `runEntry` and `serve()` already turn it into the terminal's line and the HTTP status.
2. Drop the `context.surface === 'remote'` branches that only existed to avoid `process.exit`, and the comments that explained them.
3. `run.ts` is the daemon and keeps its process calls; `registry.ts`'s `warn` is the registry's configuration and stays.
4. `rg -n "process\.(exit|stdout|stderr)" packages/server/src/commands/ --glob '!run.ts'` finds only `registry.ts`'s `warn`.
5. [daemon/05 task 08](../05-an-http-api/task-08-served-commands-act-on-the-daemons-own-options.md) changes what `status`, `user` and `optionsFrom` read over HTTP; whichever lands second rebases on the other.

## Validation

- `packages/server/test/server-cli.test.ts`: `ahpd status` with nothing running exits 1 with `ahpd: None running.` on stderr; `ahpd stop` the same; `ahpd user rm nobody --users <file>` exits 1 with `ahpd: No user called nobody.` on stderr; a `stop` refusal still exits 2.
- `packages/server/test/server-http.test.ts`: `GET /api/status` on a daemon with no record answers a 4xx with the sentence, not 500 "Failed"; today the body is `{ "message": "Failed" }`.
- `packages/server/test/server-http.test.ts`: `POST /api/user/rm/nobody` answers the sentence and the daemon keeps running.
- The `rg` of step 4.
- `pnpm typecheck` green.

## Resume

Done.
Every handler under `commands/` fails by throwing: `stop` and `refuse` throw `ArgumentError` (exit 2), and the machine-state failures throw through `conflict`, whose kind is `conflict` (exit 1) and which carries `status: 409`. Task 20 removed `refuse`; its callers call `stop`.
The status is there because `serve()` answers a plain `conflict` with 500: the decision keeps the exit code, and the validation asks for a 4xx with the sentence, so the error carries the status `serve()` reads.
`rg -n "process\.(exit|stdout|stderr)" packages/server/src/commands/ --glob '!run.ts'` finds only `registry.ts`'s `warn`.
`pnpm typecheck` green; `packages/server/test/server-cli.test.ts` 32 cases and `packages/server/test/server-http.test.ts` 10 cases green.
