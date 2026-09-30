---
title: Plugins upgrade through their own command, `ahpd plugin update`
status: superseded
superseded-by: decisions/plugin-update-takes-all-or-names.md
date: 2026-09-29
refs:
  - "[code://packages/server/src/commands/plugin.ts#L70-L126](../../packages/server/src/commands/plugin.ts#L70-L126) - `plugin install` and `plugin remove`"
  - "[code://packages/server/src/install.ts#L92-L97](../../packages/server/src/install.ts#L92-L97) - `pinned`, which pins an `@ahpd/*` name to the daemon's version"
---

## Context

Every `@ahpd/*` plugin takes `@ahpd/sdk` as a peer at its own minor.
Upgrading some of the plugins in the configuration directory can never resolve while another installed one still needs the old minor: on 2026-09-29 `ahpd plugin install @ahpd/agent-claude @ahpd/agent-cofold @ahpd/computer` failed with npm's `ERESOLVE` because `@ahpd/agent-acp` 0.7.0, installed but not loaded, still needed `@ahpd/sdk` `^0.7`.

## Decision

`ahpd plugin update` moves every package in the configuration directory's `package.json` together, in one npm call.
`plugin install` keeps installing only what it is named.

Source: Softov, 2026-09-29, asked "How should ahpd upgrade plugins, so a 0.7 to 0.8 upgrade works?": "New `plugin update`".

## Consequences

An upgrade is two commands, the daemon's and then `ahpd plugin update`.
An install that npm refuses for a peer names the installed package that blocks it and points at `ahpd plugin update`.

## Options

- **Install moves every `@ahpd` package.** `plugin install` of one `@ahpd` package moves the others too; an install would touch packages it was not named.
- **Only better messages.** The failure names the blocker and the npm command that works; the upgrade stays by hand.
