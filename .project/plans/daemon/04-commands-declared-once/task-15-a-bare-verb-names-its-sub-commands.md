---
title: A bare plugin or user names its sub-commands
status: done
depends: [task-04-docs-and-dependencies.md]
layer: "server"
refs:
  - "[code://packages/server/src/main.ts#L155-L176](../../../../packages/server/src/main.ts#L155-L176) - the hint for a group with no known sub-command"
  - "[code://packages/server/test/server-cli.test.ts#L565-L572](../../../../packages/server/test/server-cli.test.ts#L565-L572) - the `user` cases, bare and unknown"
  - "[code://packages/server/test/server-cli.test.ts#L613-L626](../../../../packages/server/test/server-cli.test.ts#L613-L626) - the `plugin` cases, bare, unknown and `--help`"
  - file:///github/cofold/packages/terminal/src/program.ts - line 140, `unknown command "<words>"`
  - "git://7a7e9d1 - packages/server/src/main.ts before the migration: \"plugin takes list, install or remove.\" and \"user takes add, rm, list or token.\""
---

## Objective

`ahpd plugin`, `ahpd user`, `ahpd plugin toy` and `ahpd user toy` each say which sub-commands exist and exit 2, while every other refusal stays cofold's.

## Files

- `UPDATE: packages/server/src/main.ts:155-176` - the hint for a group with no known sub-command.
- `UPDATE: packages/server/test/server-cli.test.ts:565-572, 613-626` - the two "refuses a sub-command it does not have" cases, plus bare-verb cases.

## Steps

1. Apply decision [ahpd-refuses-strictly-and-names-the-sub-commands](../../../decisions/ahpd-refuses-strictly-and-names-the-sub-commands.md).
2. In `main.ts`, from the words already tokenized: when the first word is the first word of a registered command's pattern, and the words match no command, write `<verb> takes <sub>, <sub> or <sub>.` to stderr, listing the second pattern words of the visible commands under it in registry order, and exit 2.
3. `--help` on the same line (`ahpd plugin --help`) is still answered by the program's help, so the hint is skipped when the line asks for help.
4. Every other refusal, and every exit code, stays what cofold gives.

## Validation

- `['plugin']` and `['plugin', 'toy', '--config-file', config]` exit 2 with stderr `plugin takes list, install or remove.`; today stderr is `ahpd: unknown command "plugin"...`.
- `['user']` and `['user', 'toy', '--users', users]` exit 2 with stderr naming `list`, `add`, `rm` and `token`.
- `['plugin', '--help']` still exits 0 with the group's help.
- `node_modules/.bin/vitest run packages/server/test/server-cli.test.ts` green.

## Resume

Done.
The line's words are tokenized once; when the first word heads a group and no command matches, and the second word is not a known sub-command, the hint names the second pattern words of the visible commands under it in registry order and exits 2.
`--help` is skipped, so `ahpd plugin --help` is still the program's group help.
`node_modules/.bin/vitest run packages/server/test/server-cli.test.ts` green, 35 cases.
