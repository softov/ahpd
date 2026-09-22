---
title: The runtime identity moves to cofold, not just the package specifiers
status: accepted
date: 2026-09-21
refs:
  - file:///github/cofold/README.md - the repository the packages now come from
  - file:///github/cofold/packages/agents/src/index.ts - the runtime whose specifiers the bridge imports
  - code://packages/agent-cofold/src/agent.ts - `defaultStoreRoot`, the provider default and the `resourceOf` fallback
  - code://packages/agent-cofold/src/config.ts - `harnessConfigPath`, the file the bridge reads
  - code://packages/agent-cofold/src/session.ts - `AGENT_ID` and the provider default
  - code://docs/PLUGINS.md - the published provider id, store path and config path a user reads
  - code://HANDOFF.md - the rename this follows, and the two options it left open
---

## Context

The harness repository was renamed `facio` -> `doopx` -> `cofold`, and its packages were renamed to `@cofold/*` with it.
That rename is committed and green; the bridge in this repository still imports `@facio/*` through links into a directory that no longer exists, so it does not build or test at all.

The rename left two separate choices, because nothing is published and nothing is installed anywhere yet, so both are still free:

- **Specifiers only.** The imports become `@cofold/*`, while the strings a user sees and types stay `facio`: the AHP provider id, `$XDG_CONFIG_HOME/facio/config.json`, `$XDG_DATA_HOME/ahpd/facio`, the `FACIO_*` environment variables and the package name `@ahpd/agent-cofold`.
- **Everything.** Those runtime strings move to `cofold` as well, and the package becomes `@ahpd/agent-cofold`.

Only the first is required to publish, which is why the handoff treated the second as a later pass and left the choice open.

The cost of the split is that the project would carry two names for one runtime indefinitely: a reader of `docs/PLUGINS.md` would write `"provider": "facio"`, pass `FACIO_*`, and find a store under `ahpd/facio`, all while every package they install is `@cofold/*`.
That mismatch has no compatibility value, because there is no installed base to keep working.

## Decision

The runtime identity is `cofold` everywhere, not only in specifiers.
The bridge imports `@cofold/*`; the AHP provider id is `cofold`; the harness configuration is `$XDG_CONFIG_HOME/cofold/config.json` or `~/.config/cofold/config.json`; the default store is `$XDG_DATA_HOME/ahpd/cofold`; and the plugin package is `@ahpd/agent-cofold`.
There are no `FACIO_*` environment variables to move, so that half of the rename does not exist.

Because the bridge is broken until the specifiers are re-pointed, the two changes land in one pass rather than two, so the repository is never committed in a state that carries both names.

## Consequences

`packages/agent-facio/` is renamed to `packages/agent-cofold/`, its `package.json` `name`, `ahpd.title` and `ahpd.entry` move with it, and the root `package.json` script that builds it changes target, as do the `paths` entry in `tsconfig.json` and the alias in `vitest.config.ts`.
The strings move in `packages/agent-cofold/src/agent.ts` (`defaultStoreRoot`, the provider default, the `displayName` default and the `resourceOf` fallback), `config.ts` (`harnessConfigPath`), `session.ts` (`AGENT_ID` and the provider default) and `plugin.ts` (the contributed `title`), and `docs/PLUGINS.md`, `docs/DAEMON.md` and `README.md` follow in the same pass so the worked example, the options table and the "Trying one today" section cannot drift from the code.
The runtime strings are what an AHP client displays and where session data and configuration are read, so any existing local session records and configuration files under `facio` names are abandoned rather than migrated; this is acceptable because the bridge is not installed anywhere.
`@ahpd/sdk` is a peer and is not renamed by this decision, so `packages/agent-cofold/package.json` keeps the `@ahpd/sdk` range while its three runtime dependencies become published `@cofold/*` ranges, which is what removed the `link:` into a directory that no longer exists.
Source symbols move with the package: `FacioOptions`, `facioAgent`, `facioSession`, `facioTools`, `facioTool`, `FacioInput` and `FacioAgent` became `CofoldOptions`, `cofoldAgent`, `cofoldSession`, `cofoldTools`, `cofoldTool`, `CofoldInput` and `CofoldAgent`, because a package whose body still said facio would read as two runtimes sharing one file.
`.project/`'s `plugin/` and decision records keep the historical prose that describes the work as it was done under the old name, while their names follow the runtime: the plan folders are `03-agent-cofold` and `04-agent-cofold-extras`, their titles say cofold, and every path reference is corrected, because a path is a link and a name is what a reader scans. This amends the first reading of this clause, and [plan records are named cofold, not facio](plan-records-follow-the-runtime-rename.md) records the fork.
`plugin/01` through `plugin/06` are already `built` records, so the rename corrects their path references and does not reopen them.

## Options

- **Specifiers only**, the handoff's minimum.
  Rejected as a resting state: it leaves a permanently split identity with no installed base to justify it, and every later reader pays for the mismatch that one pass would remove.
- **Specifiers now, identity in a second pass after the publish.**
  Rejected: it does the same edits twice and briefly publishes a `@cofold/*` package whose own docs say `facio`, which is the moment the split is most visible.
- **Keep `facio` as the provider id while packages are `cofold`**, treating the id as a client-facing brand independent of the package name.
  Rejected: the provider id is the string a user puts in configuration, so two names for one runtime would be deliberate and permanent rather than incidental.
