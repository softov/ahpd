---
title: A boolean flag nobody typed stays absent in cofold's canonical input
status: accepted
date: 2026-09-26
refs:
  - file:///github/cofold/packages/commands/src/input.ts - line 129 in `canonicalFromCli` and line 173 in `canonicalFromObject`, which write `false` for a flag with no value, no environment and no default
  - "[code://packages/server/src/commands/options.ts#L9-L12](../../packages/server/src/commands/options.ts#L9-L12) - the fields carry no `default`, so a flag is told apart from the file"
  - "[code://packages/server/src/commands/options.ts#L386](../../packages/server/src/commands/options.ts#L386) - the `updateCheck` fold"
---

## Context

[A daemon flag is declared by what it turns on](a-daemon-flag-is-declared-by-what-it-turns-on.md) spells `updateCheck` as `--update-check`, negatable, and on by default.
`@cofold/commands` 0.2.1 writes `false` into the canonical input for a boolean flag that was not typed, so `--no-update-check` and no flag at all both reach `optionsFrom` as `updateCheck: false`.
`options.ts` declares no schema defaults so that what was typed is told apart from the file, and for a boolean that is on by default the input cannot say which happened.

## Decision

In `@cofold/commands`, a boolean flag with no typed value, no environment value and no declared default is left out of the canonical input, from the terminal and from an object alike.
`context.flag(name)` still answers `false` for it.
ahpd takes the release that carries this, and `optionsFrom` folds `updateCheck` as: the typed boolean, else `false` when the file says `"updateCheck": false`, else `true`.

Source: Softov, 2026-09-26, asked "Which way for daemon/04 task 06, the update-check fold?": "cofold keeps absent undefined".

## Consequences

Every boolean in `options.ts` keeps the header rule, and a flag that is on by default can be declared positively.
A cofold consumer that reads `input.x === false` for an untyped flag now reads `undefined`, so the release is a minor version for a 0.x package and says so in its notes.
Task 06 waits for the release, which Softov publishes.

## Options

- **A schema `default: true` on `updateCheck`.** Works on 0.2.1, but breaks the header rule for one field, and `--update-check` can no longer beat `"updateCheck": false` in the file.
- **Keep `--no-update-check` as the field.** `updateCheck: true` goes on meaning off in JSON and over HTTP.
