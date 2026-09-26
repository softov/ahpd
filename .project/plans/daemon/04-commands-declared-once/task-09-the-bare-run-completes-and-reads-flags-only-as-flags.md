---
title: The bare run completes its flags, and -v and --help are read only where they are flags
status: todo
depends: [task-04-docs-and-dependencies.md]
layer: "server"
refs:
  - "[code://packages/server/src/main.ts#L33](../../../../packages/server/src/main.ts#L33) - `-v` rewritten to `--version` in every position"
  - "[code://packages/server/src/main.ts#L117-L125](../../../../packages/server/src/main.ts#L117-L125) - `asked` matches `--help`, `-h` and `--version` in every position, and the `run` word is given only when no command word is found"
  - file:///github/cofold/packages/terminal/src/completion.ts - `__complete`, which completes against the command its words name
---

## Objective

`ahpd --po<TAB>` offers `--port`, and a flag value spelled `-v` or `--help` is passed to its flag rather than answered as a question about the program.

## Files

- `UPDATE: packages/server/src/main.ts:33` - the `-v` mapping.
- `UPDATE: packages/server/src/main.ts:117-125` - `asked`, and the `run` word for a completion request.
- `UPDATE: test/server-cli.test.ts` - completion and value-position cases.

## Steps

1. Tokenize `argv` once with the program's permissive option table (as `main.ts:119-123` already does) and read `-v`, `-h`, `--help` and `--version` from the tokens that are options, never from a word consumed as a flag's value; map `-v` to `--version` only there.
2. For `__complete`: when the words after `--` hold no command word and the word being completed starts with `-`, complete against the hidden `run` command, so the foreground run's flags are offered with no word typed; an empty word keeps offering the command words.
3. Keep `run` hidden from the command list that completion offers.

## Validation

- Case "completes the foreground run's flags": `['__complete', '--', '--po']` prints `--port`. Today it prints nothing.
- Case "a value spelled -v is a value": `['--stdio', '--connection-token', '-v', '--plugin', BACKEND, '--config-file', config, '--no-update-check']` exits 0 and stderr contains `token: from --connection-token`. Today it prints the version and exits 0 without starting.
- The `--version`/`-v` and `--help`/`-h` cases in `test/server-cli.test.ts:79-94` stay green.
- `node_modules/.bin/vitest run test/server-cli.test.ts` green.

## Resume
