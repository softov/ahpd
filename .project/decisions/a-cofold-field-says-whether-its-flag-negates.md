---
title: A cofold field says whether its flag negates, and ahpd declares updateCheck through it
status: accepted
date: 2026-09-26
refs:
  - file:///github/cofold/packages/commands/src/types/field.ts - `CliField`, which carries `flag`, `short`, `value`, `complete` and `hidden`, and no `negatable`
  - file:///github/cofold/packages/commands/src/command.ts - where an option is built from a field, and where `negatable` would be passed through
  - file:///github/cofold/packages/commands/src/argv.ts - line 29, the negation registered for `negatable: true` or any flag spelled `--no-X`
  - "[decisions/a-daemon-flag-is-declared-by-what-it-turns-on.md](a-daemon-flag-is-declared-by-what-it-turns-on.md) - the positive `updateCheck` this makes declarable"
---

## Context

Decision `a-daemon-flag-is-declared-by-what-it-turns-on` wants `updateCheck` declared positively, with `--no-update-check` setting it to `false`.
`@cofold/commands` 0.2.0 builds each option from a field's `cli`, and `CliField` has no `negatable`, so a field cannot ask for its `--no-` form; only a flag spelled `--no-X` gets a negation, and then typing it sets the field to `true`.

## Decision

Add `negatable` to cofold's `CliField` in the cofold repository (`/github/cofold/packages/commands`), passed through to the option the field builds, and release it.
ahpd then declares `updateCheck` as a positive boolean with `negatable: true`, its default `true` applied after the configuration file, and `--no-update-check` setting it to `false`.
The cofold release is Softov's to publish.

Source: Softov, 2026-09-26, asked "`@cofold/commands` 0.2.0 has no `negatable` on a field's `cli`: add it to cofold and release it, or spell the ahpd field some other way in the meantime?": "Add negatable to cofold".

## Consequences

ahpd's `@cofold/commands` range moves to the release that carries it, and the lockfile with it.
The ahpd task that declares `updateCheck` waits for that release.
The same field-level `negatable` is what lets `--no-plugins` refuse `--plugins`, decision `no-plugins-has-no-positive`.

## Options

- **Spell the ahpd field another way until cofold has it.** Rejected: a stopgap spelling is a second migration of the same flag.
