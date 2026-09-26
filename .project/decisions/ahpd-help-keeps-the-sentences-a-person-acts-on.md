---
title: ahpd --help keeps the sentences a person acts on, and shows no word nobody types
status: accepted
date: 2026-09-26
refs:
  - "git://7a7e9d1 - `USAGE` in the hand-written packages/server/src/main.ts, the help these sentences come from"
  - "[code://packages/server/src/commands/options.ts#L96-L194](../../packages/server/src/commands/options.ts#L96-L194) - `serverFields`, whose descriptions are the help today"
  - "[code://packages/server/src/main.ts#L81-L92](../../packages/server/src/main.ts#L81-L92) - `liveHelp`, which appends the hidden `run` command's whole help"
---

## Context

`ahpd --help` is now rendered from the declarations.
The old usage text carried four things the declarations do not: that naming a plugin runs its code with the daemon's permissions, that `--stdio` is how a host runs inside a container for another host to carry, that every option can be a key in the configuration file spelled without the dashes, and that a client presents the token as `?tkn=<secret>` or `Authorization: Bearer <secret>`.
The foreground run's flags are appended by rendering the hidden `run` command's own help, so the screen shows `Usage: ahpd run [options]` and prints the global options twice.

## Decision

Restore some of the old help: the plugin trust warning, the `--stdio` container explanation, the paragraph saying every option can be a configuration key, and the `?tkn=` and Bearer presentation, as longer descriptions or as an epilogue.
`ahpd --help` never shows the `run` word, and prints the global options once.

Source: Softov, 2026-09-26, asked "Restore the old explanatory prose via longer descriptions or an epilogue, or accept the shorter help?": "restore some".

## Consequences

The field descriptions in `serverFields` stop claiming to be the old help verbatim.
The foreground run's section is rendered by ahpd from the `run` command's options rather than by `helpForCommand`, which always writes a usage line and a global options section.
The help test pins each restored sentence, so a later migration cannot drop one silently.

## Options

- **Accept the shorter help cofold renders.** Rejected: the trust warning and the token presentation are what a person acts on.
- **Restore the whole old usage text verbatim.** Rejected: the command list and the per-flag lines are the declarations' now, and restating them is the drift the migration removed.
