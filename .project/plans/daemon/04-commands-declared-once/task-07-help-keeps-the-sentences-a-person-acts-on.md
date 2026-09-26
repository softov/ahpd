---
title: ahpd --help keeps the sentences a person acts on
status: todo
depends: [task-04-docs-and-dependencies.md]
layer: "server"
refs:
  - "[code://packages/server/src/commands/options.ts#L95-L194](../../../../packages/server/src/commands/options.ts#L95-L194) - `serverFields` and the false claim above it"
  - "[code://packages/server/src/main.ts#L81-L92](../../../../packages/server/src/main.ts#L81-L92) - `liveHelp`, which appends `helpForCommand(run)`"
  - "git://7a7e9d1 - `USAGE` in packages/server/src/main.ts, where the restored sentences are worded"
  - file:///github/cofold/packages/terminal/src/help.ts - `helpForCommand` always writes a usage line and a global options section; `renderDefinitions` renders rows alone
---

## Objective

`ahpd --help` lists every command, then the foreground run's flags under a heading of their own, then the four restored explanations, with no `run` word and one global options section.

## Files

- `UPDATE: packages/server/src/commands/options.ts:95-100` - the comment on `serverFields`, which claims the descriptions are the old help and are not.
- `UPDATE: packages/server/src/commands/options.ts:112-115` - `stdio`'s description gains the container explanation.
- `UPDATE: packages/server/src/commands/options.ts:179-184` - `plugins`' description gains the trust warning.
- `UPDATE: packages/server/src/main.ts:81-92` - `liveHelp` renders the run's options and the epilogue itself.
- `UPDATE: test/server-cli.test.ts:79-86` - the help case pins the restored sentences.

## Steps

1. Apply decision [ahpd-help-keeps-the-sentences-a-person-acts-on](../../../decisions/ahpd-help-keeps-the-sentences-a-person-acts-on.md), taking the wording from `USAGE` at `git://7a7e9d1`.
2. `stdio`: add that this is how a host runs inside a container for another host to carry, one line of JSON per frame, no token.
3. `plugins`: add that naming one runs its code in this process with this process's permissions, so installing a plugin is the trust decision.
4. In `liveHelp`, stop calling `helpForCommand(run, ...)`; render a section headed for `ahpd [options]` from `optionsOf(run)` with `@cofold/terminal`'s `renderDefinitions`, so no `Usage: ahpd run` line and no second global options section are written.
5. After that section, an epilogue: every option can be a key in the configuration file, spelled without the dashes, and a flag beats the file; `--no-plugins` is the one flag with no key; and a client presents the token as `?tkn=<secret>` on the URL or as an `Authorization: Bearer <secret>` header.
6. Rewrite the comment above `serverFields` to say what the object is (every flag a run takes, as the fields help and the parser read), with no claim about earlier help.

## Validation

- `test/server-cli.test.ts`, the `--help` case: stdout contains `trust decision`, `container`, `without the dashes`, `?tkn=` and `Authorization: Bearer`; does not contain `ahpd run`; and contains `Global options:` exactly once.
- Today it fails on every one of those assertions (seen by hand on 2026-09-26: `Usage: ahpd run [options]` is printed and `Global options:` appears twice).
- `node_modules/.bin/vitest run test/server-cli.test.ts` green.

## Resume
