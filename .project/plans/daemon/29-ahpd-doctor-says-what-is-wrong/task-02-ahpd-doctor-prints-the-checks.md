---
title: ahpd doctor prints the checks
status: done
depends: [task-01-the-checks-say-what-is-wrong.md]
layer: server
refs:
  - "[code://packages/server/src/commands/status.ts](../../../../packages/server/src/commands/status.ts) - a CLI command with `--json` through the output contract, the pattern to copy"
  - "[code://packages/server/src/commands/registry.ts#L65](../../../../packages/server/src/commands/registry.ts#L65) - where `declareStatus` is declared, and `declareDoctor` goes beside it"
---

## Objective

`ahpd doctor` prints one line for each check, then a count of each result, and exits 1 when a check is `fail`.
`ahpd doctor --json` gives the same checks as an array.

## Files

- `CREATE: packages/server/src/commands/doctor.ts` - `declareDoctor`, the command with its text, its JSON and its exit code.
- `UPDATE: packages/server/src/commands/registry.ts:65` - declare `declareDoctor` beside `declareStatus`.
- `CREATE: packages/server/test/server-cli-doctor.test.ts` - the command's text, its JSON and its exit code.

## Steps

1. Declare `daemon.doctor` with the CLI pattern `['doctor']`, `effect: 'read'` and no HTTP surface.
2. Run `checks` from task 01, and print each check as `<result> <name>: <line>`, then its fix on the next line.
3. Print the count of `ok`, `warn` and `fail` after the last check.
4. Give the checks as an array through `output`, so `--json` prints them.
5. Write the output, then set the exit code to 1 when a check is `fail`.

## Validation

- `packages/server/test/server-cli-doctor.test.ts` holds a run with only `ok`, a run with a `warn` and a run with a `fail`.
- The cases check the text, the JSON array and the exit code of each run.
- A case checks that `ahpd doctor --json` with a running daemon holds no token.
- `pnpm -s typecheck`, `pnpm -s boundary` and `pnpm -s exec vitest run packages/server/test/server-cli-doctor.test.ts` pass.

## Resume

- **Done so far:** steps 1 to 5, 2026-10-27. `packages/server/src/commands/doctor.ts` declares `daemon.doctor` with the CLI pattern `['doctor']`, `effect: 'read'` and no HTTP surface. It runs `checks` and prints `<result> <name>: <line>`, then the fix on the next line. After the last check it prints the count of `ok`, `warn` and `fail`. A run with no `fail` returns the checks through `output`, so `--json` prints them as an array. A run with a `fail` writes the report first, in the mode the run asked for, and then fails the command. `packages/server/src/commands/registry.ts:66` declares it beside `status`. `packages/server/test/server-cli-doctor.test.ts` holds six cases. An `ok` run, a `warn` run and a `fail` run check the text, the JSON array and the exit code. A run with a token-bearing record checks that no token is printed. `pnpm -s typecheck`, `pnpm -s build`, `pnpm -s boundary`, `node tools/schema.mjs` and the test pass.
- **Next action:** build task 03.
- **Open questions:** none.
- **Watch out for:** a handler cannot set exit code 1 by assigning `process.exitCode`. `@cofold/terminal` takes the code from the run and prints only the failure, so the report goes out with `context.write` before `conflict`. The cases are Linux only, because the Service line names the systemd unit under the case's home. A launchd agent is read from the real home, which a case may not make.
