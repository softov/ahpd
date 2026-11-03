---
title: A daemon starts with no backend
domain: daemon
status: built
priority: high
created: 2026-10-26
revalidated: 2026-10-26
requires:
  - plans/plugin/67-a-plugin-raises-alerts/plan.md
refs:
  - "[code://packages/server/src/commands/run.ts#L1531-L1542](../../../../packages/server/src/commands/run.ts#L1531-L1542) - `ahpd start` exits 1 when no backend loaded"
  - "[code://packages/sdk/src/host.ts#L236](../../../../packages/sdk/src/host.ts#L236) - `createHost` throws on an empty agent list"
  - "[code://packages/sdk/src/host.ts#L1384](../../../../packages/sdk/src/host.ts#L1384) - a live fold refuses an empty agent list"
  - "[code://packages/server/src/plugins.ts#L733](../../../../packages/server/src/plugins.ts#L733) - the refusal of an old `ahpd.options` entry"
  - "[code://packages/server/src/plugins.ts#L1331-L1346](../../../../packages/server/src/plugins.ts#L1331-L1346) - the refusals of an old `manifest` and `optionsSchema` export"
  - "[code://packages/server/src/install.ts#L809](../../../../packages/server/src/install.ts#L809) - `updatePlugins`, which `ahpd plugin update` runs"
  - "[code://packages/server/src/pluginschannel.ts#L377-L425](../../../../packages/server/src/pluginschannel.ts#L377-L425) - `x-ahpd/plugins/install`, the pattern for an update method"
  - "[code://packages/agent-claude/package.json#L63-L64](../../../../packages/agent-claude/package.json#L63-L64) - the `@ahpd/sdk` peer range"
  - "[code://docs/server/UPGRADE.md](../../../../docs/server/UPGRADE.md) - how an update moves the plugins"
  - "[code://packages/server/src/plugins.ts#L326-L339](../../../../packages/server/src/plugins.ts#L326-L339) - `rootsOf`, the order a bare name is resolved in"
  - "[code://scripts/install/install.sh#L761-L770](../../../../scripts/install/install.sh#L761-L770) - the install script runs `ahpd plugin update all` on an upgrade"
---

## Goal

An update to a new ahpd never leaves a daemon that does not start. Today a 0.14.0 daemon whose agent plugins were installed by 0.12 or 0.13 refuses each plugin, finds no backend and exits 1. With this plan the daemon starts with no backend. The log and the plugin's alert name the fix. An admin updates the plugin or adds an agent from a client. The plugins of this release name the oldest daemon they load on, so an old daemon does not install a plugin it cannot load. This ships as 0.14.1.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg "serve nothing|No backend is loaded" packages/` - the three refusals in `run.ts` and `host.ts`, and the test in `packages/server/test/daemon-backend.test.ts`.
- `rg "which the daemon no longer reads" packages/server/src/plugins.ts` - the three refusals of an old plugin.
- `rg "peerDependencies" -A2 packages/*/package.json` - every first-party plugin admits `@ahpd/sdk` from 0.8, 0.10, 0.11 or 0.13.

### Runtime path

```
ahpd start -> loadPlugins -> old plugin refused (problem line, error alert) -> agents [] -> exit 1
```

### Checked by hand on 2026-10-26

Each run used XDG folders under the scratchpad, a prefix install and port 38911.

- 0.14.0 with `@ahpd/agent-claude@0.13.0` refuses its `ahpd.options` entry, logs "the engine claude did not load" and "No backend is loaded", and exits 1.
- The "No backend" line says to run `ahpd plugin install @ahpd/agent-claude`, but the plugin is installed. `ahpd plugin update all` is the fix, and after it 0.14.0 starts.
- `ahpd update` from a detached 0.13.0 daemon installs 0.14.0, moves agent-claude from 0.13.0 to 0.14.0, and the daemon restarts. The install script also runs `ahpd plugin update all`.
- So the failure is an update by `npm i -g @ahpd/server`, or from 0.12, which has no `ahpd update`.
- A 0.13.0 daemon's `ahpd plugin install @ahpd/agent-claude` installs 0.14.0, because its peer range admits 0.13.

### Gaps

- No client method updates a plugin. `x-ahpd/plugins` has install, remove, write, enable, disable, options, apply and reload.
- `Not found: a host-level alert - searched "alerts" in packages/sdk/src/host/`. An empty `agents` list on the root state is what a client reads.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A daemon with no backend starts | Softov, 2026-10-26: "I think ahpd should start without backend.. since now web can add one." | 01 |
| A module that still exports `optionsSchema` or `manifest`, or has `ahpd.options`, stays refused, as an error alert | Softov, 2026-10-26: "Keep refusing it" | 02 |
| The no-backend line and each refusal of an old plugin name `ahpd plugin update all` | (defaulted: the fix checked by hand) | 02 |
| A client updates a plugin with `x-ahpd/plugins/update {id}`, with the grant `plugin:install`, as `ahpd plugin update <name>` does | (defaulted: no other client path fixes a refused plugin) | 03 |
| Each first-party plugin's `@ahpd/sdk` peer range is `>=0.14 <1` | (defaulted: the oldest daemon the 0.14 plugins load on) | 04 |
| With `AHPD_PLUGIN_ROOT` set, a bare name resolves from the plugin root before the configuration directory | (defaulted: install and update write to the plugin root, so the copy they moved is the one that loads) | 05 |
| No start runs npm by itself | (defaulted: `ahpd update` and the install script already move the plugins) | - |

## Proposed architecture

- **Data flow** - the host takes an empty agent list. The root state lists no agents, and an agent record added later folds in live, as an edit does now.
- **Event flow** - each refused plugin raises its error alert (plugin 67). The no-backend line is a log line, not a refusal.
- **State flow** - unchanged. Sessions recorded for an agent that is gone wait for it, as they do when one agent of several is missing.
- **Layer responsibilities** - sdk: `createHost` and the fold take an empty list · server: the start, the lines, the update method · plugins: the ranges · docs: UPGRADE.md.
- **Source-of-truth files** - [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts), [`code://packages/server/src/commands/run.ts`](../../../../packages/server/src/commands/run.ts).

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The host starts with no agent](task-01-the-host-starts-with-no-agent.md) | done | - |
| [02 - An old plugin's refusal names the fix](task-02-an-old-plugins-refusal-names-the-fix.md) | done | 01 |
| [03 - A client updates a plugin](task-03-a-client-updates-a-plugin.md) | done | - |
| [04 - The plugins name the oldest daemon](task-04-the-plugins-name-the-oldest-daemon.md) | done | - |
| [05 - The plugin root loads first](task-05-the-plugin-root-loads-first.md) | done | - |

## Risks and tradeoffs

- A host with no agent has no provider for a session create. [`code://packages/sdk/src/host/lifecycle.ts#L1698`](../../../../packages/sdk/src/host/lifecycle.ts#L1698) refuses it with `-32002 No provider called <name>`, so a client gets a refusal, not a hang.
- An embedder that relied on `createHost` throwing on an empty list now gets a host. The docs say so.

## Resume state

- **Done so far:** built 2026-10-26 in PR #100, see [implemented.md](implemented.md).
- **Next action:** a fix for [the problem](../../../problems/a-client-cannot-update-a-scoped-plugin-that-failed-to-load.md); then the update from a client is checked again.
- **Open questions:** none.
- **Watch out for:** never touch `~/.config/ahpd`. A test daemon gets XDG folders under a temp folder and a port other than 37537.

## Final verification checklist

- [x] 0.14.1 with a 0.13.0 agent plugin starts, lists no agent, and logs the refusal with `ahpd plugin update all`. Checked on main at git://e19997c8 on 2026-11-03: a session create got `-32002`.
- [ ] `x-ahpd/plugins/update` moves that plugin, and the agent appears after the reload. Fails on 2026-11-03, see [the problem](../../../problems/a-client-cannot-update-a-scoped-plugin-that-failed-to-load.md).
- [x] `plans/index.md` updated.
