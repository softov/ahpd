---
title: ahpd keeps cofold's strict refusals, and a verb with no sub-command names its sub-commands
status: accepted
date: 2026-09-26
refs:
  - "git://7a7e9d1 - packages/server/src/main.ts before the migration: \"plugin takes list, install or remove.\" and \"user takes add, rm, list or token.\""
  - file:///github/cofold/packages/terminal/src/program.ts - line 140, `unknown command "<words>"` for a line that names no command
  - "[code://packages/server/src/main.ts#L117-L125](../../packages/server/src/main.ts#L117-L125) - where the line is read before the program runs it"
---

## Context

The migration to `@cofold/commands` made parsing stricter than the hand-written CLI.
`stop --bogus` and `status --bogus` exit 2 with `Unknown option` where they exited 1 with `None running.`, and `--port abc` exits 2 where it was accepted.
A bare `plugin` or `user`, and an unknown sub-command such as `plugin toy`, answer `unknown command "plugin"` where the old CLI said which sub-commands exist.

## Decision

Keep cofold's stricter parsing and its exit codes.
A bare `plugin` or `user`, and an unknown sub-command of either, says which sub-commands exist, as the old CLI did, and exits 2.

Source: Softov, 2026-09-26, asked "Keep cofold's refusals, or restore the old messages and exit codes?": "keep strict.. restore hints".

## Consequences

A script that relied on `stop --bogus` exiting 1 now sees 2.
The hint for a group is written from the registered commands, so it lists what exists rather than a sentence kept by hand.

## Options

- **Restore the old messages and exit codes.** Rejected: a flag a verb does not take is an error, and exit 2 is what every other refusal uses.
- **Keep cofold's `unknown command` for a bare group.** Rejected: `ahpd plugin` is a person asking what `plugin` does.
