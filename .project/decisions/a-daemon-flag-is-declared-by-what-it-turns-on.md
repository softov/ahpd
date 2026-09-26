---
title: A daemon flag is declared by what it turns on, and --no-X turns it off
status: accepted
date: 2026-09-26
refs:
  - "[code://packages/server/src/commands/options.ts#L189-L193](../../packages/server/src/commands/options.ts#L189-L193) - `updateCheck`, spelled `--no-update-check`, where `true` means the check is off"
  - "[code://packages/server/src/commands/options.ts#L346](../../packages/server/src/commands/options.ts#L346) - the fold that reads `updateCheck: true` as off"
  - file:///github/cofold/packages/commands/src/argv.ts - line 29 registers `--X` as the negation of any flag spelled `--no-X`, with no opt-out
  - file:///github/cofold/packages/commands/src/types/field.ts - `CliField` has no `negatable`; only an option spec does
---

## Context

`--no-update-check` is declared as the field `updateCheck`, and typing the flag sets that field to `true`, so on the declared surface `updateCheck: true` means the check is off.
The JSON input of `--json`, the HTTP API and the manifest `--remote` reads all carry that inverted name.
`@cofold/commands` registers the positive of any flag spelled `--no-X`, so `--update-check` also parses and sets the field to `false`, which turns the check on.
The parser is cofold's and behaves as written; the inverted field is ahpd's declaration.

## Decision

A boolean daemon flag is declared as the field for what it turns on, named positively, with its default applied after the configuration file is folded.
`updateCheck` is `true` unless a flag, the configuration file or the environment turns it off, and `--no-update-check` sets it to `false`.
The fix is made in ahpd's declarations, so the field name and its meaning agree on every surface.

Source: Softov, 2026-09-26, asked "Keep cofold's stricter parsing, or restore the old messages and leniency?": asked which code was at fault, and on hearing it was ahpd's declaration, to fix it in ahpd by declaring the positive form with the right default (relayed by the main session).

## Consequences

`updateCheck: true` in JSON or over HTTP means what it says.
`--update-check` and `--no-update-check` are both spellings of the one field.
`@cofold/commands` 0.2.0 has no `negatable` on a field's `cli`, so a positive field with a `--no-` spelling needs cofold to pass it through, decision [a-cofold-field-says-whether-its-flag-negates](a-cofold-field-says-whether-its-flag-negates.md).
`--no-plugins` keeps its spelling and loses its positive, decision [no-plugins-has-no-positive](no-plugins-has-no-positive.md).

## Options

- **Keep `updateCheck` spelled `--no-update-check`, with `true` meaning off.** Rejected: the name lies on every surface but the terminal.
- **Rename the field `noUpdateCheck`.** Rejected: the name would agree with its value, but a negative field is the shape the answer asked to replace.
