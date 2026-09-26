---
title: A bare plugin or user names its sub-commands
status: todo
depends: [task-04-docs-and-dependencies.md]
layer: "server"
refs:
  - "[code://packages/server/src/main.ts#L117-L125](../../../../packages/server/src/main.ts#L117-L125) - where the line's words are counted before the program runs"
  - file:///github/cofold/packages/terminal/src/program.ts - line 140, `unknown command "<words>"`
  - "git://7a7e9d1 - packages/server/src/main.ts before the migration: \"plugin takes list, install or remove.\" and \"user takes add, rm, list or token.\""
---

## Objective

`ahpd plugin`, `ahpd user`, `ahpd plugin toy` and `ahpd user toy` each say which sub-commands exist and exit 2, while every other refusal stays cofold's.

## Files

- `UPDATE: packages/server/src/main.ts:117-125` - the hint for a group with no known sub-command.
- `UPDATE: test/server-cli.test.ts:283-286` and `:327-330` - the two "refuses a sub-command it does not have" cases, plus bare-verb cases.

## Steps

1. Apply decision [ahpd-refuses-strictly-and-names-the-sub-commands](../../../decisions/ahpd-refuses-strictly-and-names-the-sub-commands.md).
2. In `main.ts`, from the words already tokenized: when the first word is the first word of a registered command's pattern, and the words match no command, write `<verb> takes <sub>, <sub> or <sub>.` to stderr, listing the second pattern words of the visible commands under it in registry order, and exit 2.
3. `--help` on the same line (`ahpd plugin --help`) is still answered by the program's help, so the hint is skipped when the line asks for help.
4. Every other refusal, and every exit code, stays what cofold gives.

## Validation

- `['plugin']` and `['plugin', 'toy', '--config-file', config]` exit 2 with stderr `plugin takes list, install or remove.`; today stderr is `ahpd: unknown command "plugin"...`.
- `['user']` and `['user', 'toy', '--users', users]` exit 2 with stderr naming `list`, `add`, `rm` and `token`.
- `['plugin', '--help']` still exits 0 with the group's help.
- `node_modules/.bin/vitest run test/server-cli.test.ts` green.

## Resume
