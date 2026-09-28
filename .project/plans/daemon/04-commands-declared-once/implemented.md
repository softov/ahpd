---
title: ahpd's commands are declared once, and the CLI is rendered from them - implemented
date: 2026-09-28
refs:
  - git://c271769
  - "[code://packages/server/src/commands/registry.ts](../../../../packages/server/src/commands/registry.ts) - `cliRegistry()`, every command in one registry"
  - "[code://packages/server/src/commands/options.ts](../../../../packages/server/src/commands/options.ts) - the daemon flag table and `optionsFrom`, the fold with the configuration file"
  - "[code://packages/server/src/main.ts](../../../../packages/server/src/main.ts) - one `Program` run through `runEntry`"
  - npm://@cofold/commands@^0.2.2 - a boolean flag nobody typed stays out of the canonical input
---

Every ahpd verb and flag is one `@cofold/commands` declaration, and `ahpd --help`, `ahpd <verb> --help`, shell completion and `--json` are rendered from it, with each command naming the grant it needs.
Nothing a person typed before changed meaning.

## What was built

- [`code://packages/server/src/commands/`](../../../../packages/server/src/commands/) - `options.ts`, `run.ts`, `start.ts`, `stop.ts`, `status.ts`, `config.ts`, `user.ts`, `plugin.ts` and `registry.ts`; `run` is the hidden foreground command a line with no word is given.
- [`code://packages/server/src/main.ts`](../../../../packages/server/src/main.ts) - the hand-written parser is gone; a bare verb names its sub-commands and fails as `ahpd: <sentence>` with exit 2, and `refuse` is gone in favour of `stop`.
- [`code://packages/server/src/commands/start.ts`](../../../../packages/server/src/commands/start.ts) - `start` forwards every option wherever it is typed, and finds the `start` that is the word.
- [`code://packages/server/src/commands/options.ts`](../../../../packages/server/src/commands/options.ts) - `updateCheck` declared as `--update-check`, negatable, folded as the typed boolean else `file.updateCheck !== false`.
- [`code://docs/DAEMON.md`](../../../../docs/DAEMON.md) - the declarations as the source of help, completion and `--json`, and the output and completion flags.

## Verified

- `packages/server/test/server-cli.test.ts` drives `main.ts` as a process: 28 pinning cases green before and unchanged after the move, 44 cases by the end, including a `start` regression that kills every daemon its log names and a token case that knocks without the token.
- `packages/server/test/server-commands.test.ts` checks the registry, every daemon flag on `start` and the scopes.
- By hand: `--help`, `plugin --help`, `completion bash`, `status --json`, and `--stdio` writing only frames.
- `pnpm test` 102 files, 1348 tests at task 17; `pnpm typecheck`, `pnpm boundary` and `pnpm install --frozen-lockfile` green.
- Reviewed by Softov on 2026-09-26, 2026-09-27 and 2026-09-28.

## Departures from the plan

- Task 06 waited on a cofold change: an untyped boolean read as `false`, so `@cofold/commands` 0.2.2 leaves it out of the input (task 17, [the decision](../../../decisions/an-untyped-flag-stays-absent-in-cofold-input.md)).
- Under `--json` a failure is still one prose line on stderr; a JSON failure shape was set aside by Softov.
- Tasks 05 to 23 after task 04 were review fixes.

## Left for later

- A JSON shape for failures is [an idea](../../../ideas/failures-have-a-json-shape.md).
- The scopes each command needs belong to [daemon/05](../05-an-http-api/plan.md).
