---
title: Each verb takes only what it reads, and the records name the right things - implemented
date: 2026-10-06
refs:
  - git://0cdbb95
  - "[code://packages/server/src/commands/options.ts](../../../../packages/server/src/commands/options.ts) - `userAt`, `userTokenFields`, `pathOf`, `setAt` and `kindOf`"
  - "[code://packages/server/src/commands/vault.ts](../../../../packages/server/src/commands/vault.ts) - `declareVault`'s `fields` and `writing`"
  - "[code://packages/server/src/commands/user.ts](../../../../packages/server/src/commands/user.ts) - the `people` comment, and the one read of the address"
  - "[code://packages/sdk/src/host/actions.ts](../../../../packages/sdk/src/host/actions.ts) - the destructuring the four left"
  - "[code://packages/server/test/server-commands.test.ts](../../../../packages/server/test/server-commands.test.ts) - the declaration case and the five `--plugin-option` cases"
  - "[code://packages/server/test/server-cli.test.ts](../../../../packages/server/test/server-cli.test.ts) - the two CLI cases"
---

Every `user` verb but `user token` now refuses `--host` and `--port`, and `vault set` and `vault delete` refuse `--config-file`: both were declared on verbs that read neither, and a flag a verb does not read is a script that believes it named something. A `--plugin-option` path that runs into a value it cannot step into is refused with the key it stopped at and the kind of value there, never the value, so a token an option holds is no longer printed on a terminal and written to a log; a step reads only keys the options hold as their own; and a step into a `{ "$secret": ... }` reference is refused rather than silently turning the reference into a plain object. `createActions` binds no host state that changes while a connection is open, and six records the review found wrong now name the right function, question, commit and next task.

## What was built

- [`code://packages/server/src/commands/options.ts`](../../../../packages/server/src/commands/options.ts) - `userAt` is `configFile` and `users` alone; `userTokenFields` adds `host` and `port` beside `url`, with a note saying why the address is that verb's alone. `setAt` reads a held value as `Object.hasOwn(here, key) ? here[key] : undefined`, refuses a value it cannot step into with `kindOf(held)` - "a number", "a list", "a string", "a boolean", "null" - in place of `JSON.stringify(held)`, and refuses a held `secretRef` before the step into it, naming the key and the secret's name.
- [`code://packages/server/src/commands/vault.ts`](../../../../packages/server/src/commands/vault.ts) - `declareVault` keeps `fields` for `vault list` and spreads `writing`, an empty record, into `vault set` and `vault delete`, the shape the file already used served. The comment says why the file is the listing's: a listing reads a configuration to say where a name is referenced before it is set, and the two that write reach `vaultPath()`.
- [`code://packages/server/src/commands/user.ts`](../../../../packages/server/src/commands/user.ts) - the `people` comment now says the address is read for a daemon started with `--host` and `--port` rather than a configuration file, and that the two are `user token`'s flags which every other verb is refused.
- [`code://packages/sdk/src/host/actions.ts`](../../../../packages/sdk/src/host/actions.ts) - `advancedTools`, `contributed`, `contributing` and `restartNeeded` are gone from `createActions`' destructuring, with a comment saying why: they change while the connection is open, so a bound copy would be the value from when it opened. Every read and write is `ctx.<name>`, as it already was.
- The six records: host/44 p2 task 02's ref note names `due`; container/04's Next action is Softov's review alone and task 09's Resume says the ended-session question was answered, and how; container/03's `implemented.md` ref is `git://52f98f6` with `ae250ef` kept where line 25 says it belongs; proxy/02's is `git://3e93f6a`; daemon/15's remaining `--config-file` line points at task 02.

## Verified

- Tasks 01, 02 and 03 each failed first. 01: `expected [ '--config-file', '--users', …(2) ] to not include '--host'`, and `expected +0 to be 2` on `user list --users <file> --port 9310`, which listed rather than refusing. 02: `expected [ '--config-file' ] to not include '--config-file'`, and the CLI answering `vault set takes no value on the line: ...` where `Unknown option --config-file` was expected - the flag accepted and read by nothing. 03: `Received: "...and presets holds 5..."` for the kind, `ArgumentError: ... toString holds undefined ...` for the own-key read, and `expected [Function] to throw an error` for the step into a `$secret`.
- Task 04 has no behaviour to fail first, as the plan's Risks says; the check is the grep, which finds the four only in comments and `ctx.` reads.
- Task 05's both validation greps: `rg -n "onDue" .project/plans/host/44-*p2*` finds only the plan's own search line, and `rg -n "ae250ef|2cb298d" .project/plans/*/0*/implemented.md` finds only container/03's line 25.
- `npx tsc -b` clean, `pnpm exec vitest run packages/server/test/server-commands.test.ts packages/server/test/server-cli.test.ts` 110 passed, and the sdk package's tests 106 files and 1496 tests passed.
- The work is uncommitted on `0cdbb95`.

## Departures from the plan

- Task 01's `user token --url` case needed the address on the two flags to be asserted rather than assumed: the case prints `ws://10.0.0.5:9310/?tkn=...`, so a `--host` that was declared and read by nothing would fail it.
- Task 03's refusal wording is the plan's, with the kind added to it ("holds a string", not "holds \"x\""). The old case that pinned the value was rewritten rather than deleted, so what the message must not contain is asserted.

## Review fixes

- A `--plugin-option` refusal still quoted the flag as typed, `a.presets.x.model=sk-live-9f2c`, with the value in it: the message said the kind of the value it stopped at, and then printed the value being set beside it. Every refusal about one now quotes the path alone, `<plugin>.<key>` up to the `=`, through `pathOf` - the three in `setAt` and the two that refuse a flag which is not `<plugin>.<key>=<value>`, which printed it too. A flag with nothing before its `=` names no path, and is refused as `an empty path` rather than as the value. The four cases were rewritten with secret-looking values, and each failed first showing the leak: `--plugin-option sets a.presets.x.model=sk-live-9f2c, and presets holds a number`, `sets a.key.x=sk-live-9f2c`, `sets a.__proto__.x=sk-live-9f2c`, and `takes <plugin>.<key>=<value>, not =1`.
- This file's ref and its closing line said `e1c4ccc`. The base commit is `0cdbb95`, which is what the rest of the plan's records name. Corrected in both places.

## Left for later

- none. Nothing this plan named is left; there is no `deferred.md`.
