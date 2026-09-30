---
title: "`ahpd plugin update` takes `all` or the names to move"
status: accepted
date: 2026-09-29
supersedes: decisions/plugins-upgrade-through-their-own-command.md
refs:
  - "[code://packages/server/src/commands/plugin.ts](../../packages/server/src/commands/plugin.ts) - the plugin commands"
---

## Context

`ahpd plugin update` first moved every installed plugin together, because plugins shared one `@ahpd/sdk` in the configuration directory.
With [a plugin loads the daemon's sdk](a-plugin-loads-the-daemons-sdk.md), plugins no longer depend on each other, so moving one alone is safe.

## Decision

`ahpd plugin update all` moves every installed plugin; `ahpd plugin update <name>...` moves only those.
`ahpd plugin update` with neither says so and shows both forms.
Plugins upgrade through this command, and `plugin install` installs only what it is named.

Source: Softov, 2026-09-29, asked "How should `ahpd plugin update` take names?": "`update all` keyword" (option text: "`ahpd plugin update all` or `ahpd plugin update <name>...`; plain `update` with no name is an error that shows both forms").

## Consequences

Moving everything is spelled out, and a named update never moves a plugin it was not named.

## Options

- **Optional names.** No name moves everything, as `npm update` and `brew upgrade` do.
- **All only.** No names at all.
