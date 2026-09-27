---
title: The bare run completes its flags, and -v and --help are read only where they are flags
status: done
depends: [task-04-docs-and-dependencies.md]
layer: "server"
refs:
  - "[code://packages/server/src/main.ts#L39](../../../../packages/server/src/main.ts#L39) - `argv0`, the words as typed rather than rewritten"
  - "[code://packages/server/src/main.ts#L157-L159](../../../../packages/server/src/main.ts#L157-L159) and [#L187-L188](../../../../packages/server/src/main.ts#L187-L188) - the union table once, `asked` from the tokens that are options, and the `run` word"
  - "[code://packages/server/src/main.ts#L192-L211](../../../../packages/server/src/main.ts#L192-L211) - `completionLine`, which names `run` before a word that starts with `-`"
  - "[code://packages/server/test/server-cli.test.ts#L207-L224](../../../../packages/server/test/server-cli.test.ts#L207-L224) - the completion and value-position cases"
  - file:///github/cofold/packages/terminal/src/completion.ts - `__complete`, which completes against the command its words name
---

## Objective

`ahpd --po<TAB>` offers `--port`, and a flag value spelled `-v` or `--help` is passed to its flag rather than answered as a question about the program.

## Files

- `UPDATE: packages/server/src/main.ts:39` - the words are left as typed, so a `-v` that a flag consumed stays that flag's value.
- `UPDATE: packages/server/src/main.ts:157-159, 187-188` - the union table read once, `asked` from the tokens that are options, and the `run` word.
- `UPDATE: packages/server/src/main.ts:192-211` - `completionLine`, which names `run` before a word that starts with `-` and no command.
- `UPDATE: packages/server/test/server-cli.test.ts:207-224` - completion and value-position cases.

## Steps

1. Tokenize `argv` once with the program's permissive option table (as `main.ts:157-159` already does) and read `-v`, `-h`, `--help` and `--version` from the tokens that are options, never from a word consumed as a flag's value; map `-v` to `--version` only there.
2. For `__complete`: when the words after `--` hold no command word and the word being completed starts with `-`, complete against the hidden `run` command, so the foreground run's flags are offered with no word typed; an empty word keeps offering the command words.
3. Keep `run` hidden from the command list that completion offers.

## Validation

- Case "completes the foreground run's flags": `['__complete', '--', '--po']` prints `--port`. Today it prints nothing.
- Case "a value spelled -v is a value": `['--stdio', '--connection-token', '-v', '--plugin', BACKEND, '--config-file', config, '--no-update-check']` exits 0 and stderr contains `token: from --connection-token`. Today it prints the version and exits 0 without starting.
- The `--version`/`-v` and `--help`/`-h` cases in `packages/server/test/server-cli.test.ts:169-191` stay green.
- `node_modules/.bin/vitest run packages/server/test/server-cli.test.ts` green.

## Resume

Done.
The words are tokenized once with the program's union table: `asked` reads `--help`, `--version` and `-v` from the tokens that are options, and `-v` is rewritten to `--version` only for a line that holds it as one.
A completion request whose typed words name no command and whose last word starts with `-` gets the hidden `run` named before it, so the foreground run's flags are offered with no word typed.
`node_modules/.bin/vitest run packages/server/test/server-cli.test.ts` green, 34 cases.
