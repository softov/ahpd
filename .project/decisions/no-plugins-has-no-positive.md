---
title: --no-plugins has no positive, so --plugins is an unknown option
status: accepted
date: 2026-09-26
refs:
  - "[code://packages/server/src/commands/options.ts#L185-L188](../../packages/server/src/commands/options.ts#L185-L188) - `noPlugins`, spelled `--no-plugins`"
  - file:///github/cofold/packages/commands/src/argv.ts - line 29, which registers `--plugins` as the negation of `--no-plugins`
  - "[decisions/a-cofold-field-says-whether-its-flag-negates.md](a-cofold-field-says-whether-its-flag-negates.md) - the field-level `negatable` this uses"
---

## Context

`@cofold/commands` registers the positive of any flag spelled `--no-X`, so `ahpd --plugins` parses and sets `noPlugins` to `false`.
That means nothing a person would type, and the hand-written CLI refused it as `Unknown option --plugins`.
`--plugin` (singular) is the flag that names a plugin, so `--plugins` is one letter from a real flag and easy to type by mistake.

## Decision

Declare `--no-plugins` with `negatable: false`, so `--plugins` is an unknown option, as it was before.
cofold honours `negatable: false` on a field by not registering the automatic opposite of a `--no-X` flag.

Source: Softov, 2026-09-26, asked "`--no-plugins` makes cofold also accept `--plugins`: accept it, or add a `negatable: false` opt-out to cofold?": "Refuse it".

## Consequences

`ahpd --plugins` exits 2 with `Unknown option --plugins.`, and completion does not offer it.
The cofold change that adds `negatable` to a field also makes an explicit `false` suppress the automatic `--no-X` opposite.

## Options

- **Accept `--plugins` as the no-op cofold gives it.** Rejected: a flag that parses and means nothing hides a typo of `--plugin`.
