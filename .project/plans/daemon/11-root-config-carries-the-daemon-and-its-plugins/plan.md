---
title: Root config carries the daemon's settings and each plugin's options, and a client edits them
domain: daemon
status: built
priority: high
created: 2026-09-29
revalidated: 2026-09-29
requires: []
decisions:
  - decisions/plugin-configuration-travels-in-root-config.md
  - decisions/root-config-shows-daemon-keys-to-config-read-and-never-a-write-only-value.md
  - decisions/a-configuration-change-applies-live-or-on-ahpd-restart.md
  - decisions/a-repeated-plugin-is-keyed-by-its-provider.md
refs:
  - "[code://packages/sdk/src/host.ts#L4954-L5044](../../../../packages/sdk/src/host.ts#L4954-L5044) - `rootConfig`, `ROOT_CONFIG_SCHEMA` and `rootState`, in memory only"
  - "[code://packages/sdk/src/host.ts#L8086-L8145](../../../../packages/sdk/src/host.ts#L8086-L8145) - `root/configChanged`, and the retool that follows `artifactToolsCompactPrompts`"
  - "[code://packages/sdk/src/host.ts#L282-L320](../../../../packages/sdk/src/host.ts#L282-L320) - `dispatchNeeds` and `PER_CONNECTION`"
  - "[code://packages/sdk/src/host.ts#L1655-L1674](../../../../packages/sdk/src/host.ts#L1655-L1674) - `seenBy`, what each connection is sent"
  - "[code://packages/sdk/src/types/host.ts#L64-L263](../../../../packages/sdk/src/types/host.ts#L64-L263) - `HostOptions`, which has no root config field"
  - "[code://packages/server/src/commands/options.ts#L117-L263](../../../../packages/server/src/commands/options.ts#L117-L263) - `serverFields`, `configSchema` and `pluginEntry`"
  - "[code://packages/server/src/install.ts#L137-L223](../../../../packages/server/src/install.ts#L137-L223) - `readEntry` and `writeEntry`, today's only writer of `config.json`"
  - "[code://packages/server/src/commands/plugin.ts#L64-L69](../../../../packages/server/src/commands/plugin.ts#L64-L69) - `oneAtATime`, which serialises writes"
  - "[code://packages/server/src/plugins.ts#L420-L440](../../../../packages/server/src/plugins.ts#L420-L440) - a plugin's `optionsSchema` and the check at load"
  - "[code://packages/server/src/commands/config.ts#L24-L44](../../../../packages/server/src/commands/config.ts#L24-L44) - the served masks"
---

## Goal

A person with `config:read` sees the daemon's settings and every configured plugin's options as a form, in ahpapp or VS Code; with `config:write` they change them.
A change that can apply while the daemon runs applies at once; any other is written to `config.json` and the host says a restart is needed.
A credential is never sent back, only whether it is set.

## Reconnaissance

The files read are the `refs` above.

### Runtime path

```
connect -> rootState: ROOT_CONFIG_SCHEMA (three host keys) -> form
root/configChanged { paths: [...] } -> dispatchNeeds: config:write -> rootConfig (memory) -> nothing reads it
```

### Gaps

- Root config declares three host keys; the daemon's settings and plugin options are file-only.
- Nothing writes `config.json` but `plugin install` and `plugin remove`.
- The served answers mask every plugin option value, so a form could show none.

## Decisions locked in

| Decision | Task |
| --- | --- |
| [A plugin's configuration travels in root config, not in customizations](../../../decisions/plugin-configuration-travels-in-root-config.md) | 01, 03 |
| [Daemon and plugin keys reach only connections with config:read, and a write-only value never leaves the host](../../../decisions/root-config-shows-daemon-keys-to-config-read-and-never-a-write-only-value.md) | 01, 04 |
| [A configuration change applies live where the key can, and otherwise on `ahpd restart`](../../../decisions/a-configuration-change-applies-live-or-on-ahpd-restart.md) | 02, 05 |
| [A plugin loaded more than once is keyed by its provider in root config](../../../decisions/a-repeated-plugin-is-keyed-by-its-provider.md) | 03, 04 |

| What | Source | Task |
| --- | --- | --- |
| The daemon keys are `paths`, `port`, `host`, `http`, `updateCheck`, `advancedTools` and `wire`; not `stdio`, `configFile`, the connection token keys, `trustToken`, `issuer`, `resource`, `users`, `automations` or `sessions` | Softov, 2026-09-29: "plugins, paths, listen, updateCheck and some more relevant ... stdio, configFile, connectionToken, trustToken, and issuer not now", then "advancedTools, wire" | 02 |
| `advancedTools` and `wire` apply live; the others set `_meta["ahpd.restartNeeded"]` | Softov, 2026-09-29: "things that could be applyed direct without restart could be apply.. like wire. advancedTools, etc. host gets a _meta for restart needed" | 02, 05 |
| Each configured plugin is one key, `plugins.<name>`, whose value is `{ enabled, options }`; `config.json` keeps its `plugins` array | (defaulted: a form needs one schema per plugin, and an array item cannot carry a schema per name) | 03 |
| A plugin that did not load shows `enabled` and its options with no schema | (defaulted: its `optionsSchema` is in a module that was not imported) | 03 |
| Root config shows the file's value; a start flag that overrides it is said in the key's description | (defaulted: the file is what a form edits) | 02 |
| A write is checked with `checkConfig` and the plugin's schema before `config.json` is touched, and a refusal names the key | (defaulted: a bad write must not stop the next start) | 02, 03 |
| Our plugins mark their credentials `writeOnly`, wherever in their options the credential sits | the decision above | 04 |
| A plugin loaded once is `plugins.<name>`; a repeated name is keyed `plugins.<name>#<provider>`, and an entry of it with no provider is refused at start | [a-repeated-plugin-is-keyed-by-its-provider](../../../decisions/a-repeated-plugin-is-keyed-by-its-provider.md) | 03 |

## Proposed architecture

- **Data flow** - the daemon hands the host a `rootConfig` port: `{ schema(), values(), write(values) }`; the host adds its schema and values to what a `config:read` connection is sent, and routes a `root/configChanged` on those keys to `write`, which answers what applied live and whether a restart is needed.
- **State flow** - `config.json` is the source; `write` goes through `readEntry` and `writeEntry` inside `oneAtATime`.
- **Layer responsibilities** - sdk: the port, the grant, the per-connection state, the `_meta` · server: the keys, the checks, the file, the live keys.
- **Source-of-truth files** - [`code://packages/sdk/src/types/host.ts`](../../../../packages/sdk/src/types/host.ts), [`code://packages/server/src/commands/options.ts`](../../../../packages/server/src/commands/options.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The host takes a root config port, shown to config:read](task-01-the-host-takes-a-root-config-port.md) | done | - |
| [02 - The daemon's keys in root config](task-02-the-daemons-keys.md) | done | 01 |
| [03 - Each plugin is a key](task-03-each-plugin-is-a-key.md) | done | 02 |
| [04 - A write-only value is never answered](task-04-a-write-only-value-is-never-answered.md) | done | 03 |
| [05 - advancedTools and wire apply live](task-05-advanced-tools-and-wire-apply-live.md) | done | 02 |
| [06 - Docs](task-06-docs.md) | done | 04, 05 |

## Risks and tradeoffs

- `writeEntry` rewrites `config.json` with two-space JSON; formatting the operator added is lost, as it already is on `plugin install`.
- VS Code draws these keys as settings; a key it cannot draw is shown as JSON there.

## Resume state

- **Done so far:** built 2026-10-02, see [implemented.md](implemented.md) and [deferred.md](deferred.md).

## Final verification checklist

- [ ] ahpapp signed in as admin shows the daemon keys and each plugin; a member sees the three host keys only.
- [x] Setting `agent-claude`'s `workerStop` writes `config.json` and root state says `ahpd.restartNeeded`.
- [x] Turning `advancedTools` on changes the tools of running sessions without a restart.
- [x] `agent-cofold`'s `apiKey` reads `<set>` everywhere but the terminal's `ahpd config`.
- [x] `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.
- [x] `plans/index.md` updated.
