---
title: An unknown configuration key warns, and the daemon starts
status: accepted
date: 2026-09-28
refs:
  - "[code://packages/server/src/commands/options.ts#L312-L388](../../packages/server/src/commands/options.ts#L312-L388) - `optionsFrom`, which ignores a key it does not read"
---

## Context

The daemon's configuration is checked against one schema.
A key the schema does not name is either a typo, such as `"plugin"` for `"plugins"`, or a key a newer version added.

## Decision

An unknown key prints one line naming the file and the key, and the daemon starts.
A known key with a wrong value still refuses the start.

Source: Softov, 2026-09-28, asked "A key in config.json the daemon does not know (a typo like \"plugin\", or a key from a newer version):": "Warn and start".

## Consequences

An older daemon reading a file written for a newer one keeps running, and says what it did not understand.
A typo is visible on the first start instead of silently doing nothing.

## Options

- **Refuse the start.** Every key must be known; a downgrade after adding a key stops the daemon until the file is edited.
