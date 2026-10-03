---
title: The docs say a credential on the command line is given as a `$secret`
status: todo
depends: [task-03-docs.md]
layer: "docs"
refs:
  - "[code://docs/DAEMON.md#L440-L449](../../../../docs/DAEMON.md#L440-L449) - the `--plugin-option` paragraph, which says a credential is better set with `plugin config`"
  - "[code://packages/server/src/daemon.ts#L25-L29](../../../../packages/server/src/daemon.ts#L25-L29) - `argv` in the daemon record, which keeps every typed flag"
  - "[code://packages/server/src/plugins.ts#L540](../../../../packages/server/src/plugins.ts#L540) - every `{ \"$secret\": \"<name>\" }` in an option is read at load"
---

## Objective

`docs/DAEMON.md` says a credential given with `--plugin-option` or `plugin config` is written as `{"$secret":"<name>"}`, with the value kept in the vault, because a plain value lands in the shell's history, in `daemon.json`'s `argv` for a restart, or in `config.json`.

## Files

- `UPDATE: docs/DAEMON.md:449` - the sentence that says a credential is better set with `plugin config`.

## Steps

1. Replace that sentence: a typed value lands in the shell's history and in the daemon record's `argv`, which `ahpd restart` starts again; a credential goes as a `$secret` reference, with one example such as `ahpd --plugin-option '@ahpd/plugin-orders.apiKey={"$secret":"host:stripe"}'`, and a link to the vault section.
2. One line per paragraph, as the surrounding prose is.

## Validation

- Read against `optionsFrom` (`typedValue` parses the JSON object) and the vault section of the same file.
- By hand: `ahpd vault set host:x`, then a start with that `--plugin-option`; `daemon.json` holds the reference and not the value.

## Resume
