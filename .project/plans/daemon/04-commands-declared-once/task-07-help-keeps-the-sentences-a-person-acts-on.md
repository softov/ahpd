---
title: ahpd --help keeps the sentences a person acts on
status: done
depends: [task-04-docs-and-dependencies.md]
layer: "server"
refs:
  - "[code://packages/server/src/commands/options.ts#L110-L111](../../../../packages/server/src/commands/options.ts#L110-L111) - `serverFields`, and the comment that now says what it is"
  - "[code://packages/server/src/commands/options.ts#L122-L125](../../../../packages/server/src/commands/options.ts#L122-L125) - `stdio`'s description, with the container explanation"
  - "[code://packages/server/src/commands/options.ts#L189-L194](../../../../packages/server/src/commands/options.ts#L189-L194) - `plugins`' description, with the trust warning"
  - "[code://packages/server/src/main.ts#L128-L133](../../../../packages/server/src/main.ts#L128-L133) - `liveHelp`, which renders the run's section itself"
  - "[code://packages/server/src/main.ts#L211-L239](../../../../packages/server/src/main.ts#L211-L239) - `optionLine` and `runHelp`, the section and the epilogue"
  - "[code://packages/server/test/server-cli.test.ts#L184-L198](../../../../packages/server/test/server-cli.test.ts#L184-L198) - the help case, pinning the restored sentences"
  - "git://7a7e9d1 - `USAGE` in packages/server/src/main.ts, where the restored sentences are worded"
  - file:///github/cofold/packages/terminal/src/help.ts - `helpForCommand` always writes a usage line and a global options section; `renderDefinitions` renders rows alone
---

## Objective

`ahpd --help` lists every command, then the foreground run's flags under a heading of their own, then the four restored explanations, with no `run` word and one global options section.

## Files

- `UPDATE: packages/server/src/commands/options.ts:110` - the comment on `serverFields`, which now says what the object is.
- `UPDATE: packages/server/src/commands/options.ts:122-125` - `stdio`'s description gains the container explanation.
- `UPDATE: packages/server/src/commands/options.ts:189-194` - `plugins`' description gains the trust warning.
- `UPDATE: packages/server/src/main.ts:128-133, 211-239` - `liveHelp` renders the run's options and the epilogue itself.
- `UPDATE: packages/server/test/server-cli.test.ts:184-198` - the help case pins the restored sentences.

## Steps

1. Restore the four sentences the plan's table names, taking the wording from `USAGE` at `git://7a7e9d1`.
2. `stdio`: add that this is how a host runs inside a container for another host to carry, one line of JSON per frame, no token.
3. `plugins`: add that naming one runs its code in this process with this process's permissions, so installing a plugin is the trust decision.
4. In `liveHelp`, stop calling `helpForCommand(run, ...)`; render a section headed for `ahpd [options]` from `optionsOf(run)` with `@cofold/terminal`'s `renderDefinitions`, so no `Usage: ahpd run` line and no second global options section are written.
5. After that section, an epilogue: every option can be a key in the configuration file, spelled without the dashes, and a flag beats the file; `--no-plugins` is the one flag with no key; and a client presents the token as `?tkn=<secret>` on the URL or as an `Authorization: Bearer <secret>` header.
6. Rewrite the comment above `serverFields` to say what the object is (every flag a run takes, as the fields help and the parser read), with no claim about earlier help.

## Validation

- `packages/server/test/server-cli.test.ts`, the `--help` case: stdout contains `trust decision`, `container`, `without the dashes`, `?tkn=` and `Authorization: Bearer`; does not contain `ahpd run`; and contains `Global options:` exactly once.
- Today it fails on every one of those assertions (seen by hand on 2026-09-26: `Usage: ahpd run [options]` is printed and `Global options:` appears twice).
- `node_modules/.bin/vitest run packages/server/test/server-cli.test.ts` green.

## Resume

Done.
The run's flags are a section of their own, rendered from `optionsOf(run)` with `renderDefinitions` under `ahpd [options]:`, so no `Usage: ahpd run` line and one `Global options:` section.
The container explanation is on `--stdio`, the trust warning on `--plugin`, and the configuration keys and the two token spellings follow the section as prose worded from `USAGE` at `git://7a7e9d1`.
`node_modules/.bin/vitest run packages/server/test/server-cli.test.ts` green, 35 cases.
