---
title: A plugin option is given on the command line by repeating `--plugin-option <plugin>.<key>=<value>`
status: accepted
date: 2026-09-29
refs:
  - "[code://packages/server/src/commands/options.ts#L367-L440](../../packages/server/src/commands/options.ts#L367-L440) - `optionsFrom`, a flag over the file over the default"
  - "[code://packages/server/src/plugins.ts#L420-L440](../../packages/server/src/plugins.ts#L420-L440) - options checked against the plugin's schema at load"
---

## Context

Every daemon key but `http` can be overridden by a start flag; a plugin's options can only be set in `config.json`.
A plugin's options schema is in its module, so a flag value cannot be checked until the plugin is imported.

## Decision

`--plugin-option <plugin>.<key>=<value>` sets one option for that run, and is repeated for each.
The value is read as JSON when it parses and as a string otherwise, and it is checked with the file's options when the plugin loads, failing the same way.

Source: Softov, 2026-09-29, asked which flag form, after being told a flag is checked at load and repeated per key: "Its repeat --plugin-option".

## Consequences

One flag spelling for every plugin, known before any plugin is read.
Several options take several flags.

## Options

- **One JSON object per plugin** (`--plugin-options agent-claude='{...}'`): shorter for many keys, hard to quote in a shell.
- **One flag per option, generated from the schema**: needs every plugin imported before the flags are parsed.
