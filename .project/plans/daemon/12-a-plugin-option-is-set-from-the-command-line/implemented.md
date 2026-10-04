---
title: A plugin option is set from the command line, in the file or for one run - implemented
date: 2026-10-04
refs:
  - git://5221af7
  - git://7279780
  - "[code://packages/server/src/commands/options.ts](../../../../packages/server/src/commands/options.ts)"
  - "[code://packages/server/src/commands/plugin.ts](../../../../packages/server/src/commands/plugin.ts)"
---

A plugin's option is set in the file with `ahpd plugin config`, switched with `plugin enable` and `plugin disable`, or set for one run with `--plugin-option <plugin>.<key path>=<value>`, where the key path reaches as deep into the plugin's options as it names.

## What was built

- [`code://packages/server/src/commands/plugin.ts`](../../../../packages/server/src/commands/plugin.ts) - `plugin config`, `plugin enable` and `plugin disable`, in `5221af7`.
- [`code://packages/server/src/commands/options.ts`](../../../../packages/server/src/commands/options.ts) - `--plugin-option`, finding the plugin as the longest name this run loads that the flag starts with, and `setAt`, which sets the rest of the flag as a key path, makes a missing key on the way down, refuses one that is there and is not an object, and refuses `__proto__`, `constructor` and `prototype`.
- `docs/DAEMON.md` says the key is a path and that a credential goes as a `{"$secret":"..."}` reference.

## Verified

- `packages/server/test/server-commands.test.ts` covers a key set deep beside other presets, a key made on the way down, a typed value on the way down, the refusal through a non-object, the refusal through a prototype key, and the longest name winning over a shorter prefix.
- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` (180 files, 2792 tests) pass.

## Departures from the plan

- Task 04 was docs-only in its own file; it carries the key path code too, as the plan's table assigned it, Softov, 2026-10-04.
- The prototype-key refusal was added in review; the plan did not name it.

## Left for later

- The three by-hand checks of the final checklist (a real `plugin config`, a start with a refused `--plugin-option`, and a `$secret` reference left alone in `daemon.json`) have not been run.
- The tasks stay `implemented` until Softov reviews them.
