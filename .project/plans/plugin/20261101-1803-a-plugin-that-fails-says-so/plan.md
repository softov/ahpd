---
title: A plugin that fails says so
domain: plugin
status: planned
priority: medium
created: 2026-11-01
revalidated: 2026-11-01
requires: []
changes: []
creates: []
refs:
  - git://9a6232a0 - the commit of ahpd this plan was checked at, and the last one that holds the brief `.project/briefs/a-plugin-that-fails-says-so.md`
  - git://9a6232a0:.project/briefs/a-plugin-that-fails-says-so.md - the brief this plan covers
  - "[code://packages/tunnel-devtunnel/src/devtunnel.ts#L209-L224](../../../../packages/tunnel-devtunnel/src/devtunnel.ts#L209-L224) - `prepare`, which passes `--port` to `access create` when anonymous is on"
  - "[code://packages/tunnel-devtunnel/src/devtunnel.ts#L239-L251](../../../../packages/tunnel-devtunnel/src/devtunnel.ts#L239-L251) - `host`, which logs a spawn error and has no `exit` listener"
  - "[code://packages/tunnel-devtunnel/src/plugin.ts#L119-L141](../../../../packages/tunnel-devtunnel/src/plugin.ts#L119-L141) - `read`, which logs the first failed `show` of a run"
  - "[code://packages/tunnel-devtunnel/src/plugin.ts#L144-L216](../../../../packages/tunnel-devtunnel/src/plugin.ts#L144-L216) - the `listening` handler, which catches each failure and calls only `plugin.log`"
  - "[code://packages/tunnel-devtunnel/src/plugin.ts#L218-L236](../../../../packages/tunnel-devtunnel/src/plugin.ts#L218-L236) - the `stopping` handler, which kills `devtunnel host` and removes the tunnel"
  - "[code://packages/activepieces/src/plugin.ts#L341-L345](../../../../packages/activepieces/src/plugin.ts#L341-L345) - the pattern: an `error` alert with a `ref`, replaced on success"
  - "[code://packages/sdk/src/types/plugin.ts#L789-L807](../../../../packages/sdk/src/types/plugin.ts#L789-L807) - `Alert`, with a `level`, a `text` and a `ref`"
  - "[code://packages/sdk/src/plugins/plugins.ts#L1834-L1863](../../../../packages/sdk/src/plugins/plugins.ts#L1834-L1863) - `raise`, which gives a handler that throws to `onProblem` as one line, with `listener.by`"
  - "[code://packages/server/src/commands/run.ts#L1475-L1511](../../../../packages/server/src/commands/run.ts#L1475-L1511) - `applyNow`, which loads and unloads plugins while the daemon runs and raises no event"
  - "[code://packages/server/src/commands/run.ts#L1808-L1821](../../../../packages/server/src/commands/run.ts#L1808-L1821) - `listening`, raised once at start, with `stamp` as `onProblem`"
  - "[code://packages/server/src/commands/run.ts#L1954](../../../../packages/server/src/commands/run.ts#L1954) - `stopping`, raised once at the way down"
  - "[code://packages/server/src/applyplugins.ts#L136-L176](../../../../packages/server/src/applyplugins.ts#L136-L176) - the unload and load loops of an apply"
  - "[code://packages/server/src/plugins.ts#L1844-L1880](../../../../packages/server/src/plugins.ts#L1844-L1880) - `alerted` and `addAlert`, the alerts each row holds"
  - "[code://packages/server/src/plugins.ts#L2102-L2130](../../../../packages/server/src/plugins.ts#L2102-L2130) - `unload`, which runs the closers and raises no `stopping`"
  - "[code://docs/plugins/PLUGINS.md#L1171](../../../../docs/plugins/PLUGINS.md#L1171) - the docs of `listening` and `stopping`"
---

## Goal

A plugin that fails after it loads says so on its row, as an alert, and not only in the daemon's log.
The Dev Tunnel plugin works with anonymous access on, and says when it cannot make or keep its tunnel.
It comes back when a person disables and enables it.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg "'listening'" packages/server/src packages/sdk/src` - raised only in `run.ts`, once, at start.
- `rg "stopping" packages/server/src/plugins.ts packages/sdk/src/plugins` - an unload does not raise it.
- `rg "restart:" packages/server/src` - an apply asks for a restart only for a port or a URI scheme.
- `rg "onClose|closer" packages/tunnel-devtunnel/src` - the Dev Tunnel plugin registers no closer.

### Runtime path

```
ahpw switch -> x-ahpd/plugins -> applyNow -> applyPlugins: unload (closers) / load
  -> nothing raised: no tunnel after enable, the old `devtunnel host` still runs after disable
daemon start -> raise(listening) -> devtunnel listening handler -> find/create, prepare, forward, host
  -> a failure: plugin.log only -> the row still says ready, with no alert
```

### Gaps

- `prepare` passes `--port`; the Dev Tunnels CLI 1.0.2094 knows only `-p, --port-number`.
- The test at `tunnel-devtunnel.test.ts:131` expects `--port`.
- A plugin loaded after start never gets `listening`, and a plugin unloaded while the daemon runs never gets `stopping`.
- No failure of the Dev Tunnel plugin reaches its row.
- A handler that throws reaches only stderr.

## Answers

| What | Source | Task |
| --- | --- | --- |
| `prepare` passes `-p` to `access create`, as it does to `port create` | Softov, 2026-11-01: "I think its because the broken command... when I selected anonymous" | 01 |
| The Dev Tunnel plugin raises an `error` alert with the `ref` `tunnel` when it cannot find, make or prepare its tunnel, or cannot listen on 31546 | Softov, 2026-11-01, chose "Commit it, then plan it" for the brief that states it | 03 |
| An exit of `devtunnel host` that the plugin did not ask for raises the same alert | Softov, 2026-11-01, chose "Commit it, then plan it" for the brief that states it | 03 |
| The plugin clears the `tunnel` alert when the tunnel is hosted | Softov, 2026-11-01, chose "Commit it, then plan it" for the brief that states it | 03 |
| The first failed `devtunnel show` of a run raises a `warning` alert with the `ref` `read`, and the next good read clears it | Softov, 2026-11-01, chose "Warning alert" | 03 |
| The plugin does not try again by itself after a failure | Softov, 2026-11-01: "no retry" | 03 |
| The daemon raises `listening` to a plugin it loads after the socket is open, with the address it raised at start | Softov, 2026-11-01, chose "Raise listening late" | 02 |
| The daemon raises `stopping` to a plugin it unloads while it runs, before the plugin's closers | (defaulted: the pair of a late `listening`; with no `stopping`, a disable leaves `devtunnel host` running and an enable starts a second one) | 02 |
| Over stdio, a late load raises no `listening`, as at start | (defaulted: [`code://docs/plugins/PLUGINS.md#L1171`](../../../../docs/plugins/PLUGINS.md#L1171)) | 02 |
| The daemon raises an `error` alert on the plugin's row when one of its handlers throws, and keeps the line on stderr | Softov, 2026-11-01, chose "Commit it, then plan it" for the brief that states it | 04 |
| The daemon's alert has the `ref` `event:<type>`, so the next throw at the same event replaces it | (defaulted: one alert per event, not one per throw) | 04 |
| Clients work out "failing" from an `error` alert, as ahpw's list does; ahpd sends no new field, and `state` keeps its meaning | Softov, 2026-11-01, chose "Clients derive it" | - |
| The words of each alert follow the brief `the-text-a-person-reads-is-plain.md` | (defaulted: the brief the other session holds for text a person reads) | 03, 04 |

## Proposed architecture

- **Data flow** - a failure in the plugin calls `plugin.alert`; a handler that throws reaches `addAlert` through a new `alert` on the holdings set. Both land on the row's alerts, which the plugins channel already sends.
- **Event flow** - `applyNow` keeps the address it raised `listening` with. After an apply, it raises `listening` to each plugin the apply loaded and `stopping` to each one it unloaded or reloaded.
- **State flow** - the Dev Tunnel plugin replaces its `tunnel` alert on each failure and clears it when hosted. It replaces its `read` alert on the first failed read of a run and clears it on the next good read.
- **Layer responsibilities** - `tunnel-devtunnel`: the flag, the alerts and the `exit` listener · `server`: the late events and the daemon's alert · `sdk`: `raise` passes `by` to `onProblem`.
- **Source-of-truth files** - [`code://packages/server/src/applyplugins.ts`](../../../../packages/server/src/applyplugins.ts), [`code://packages/tunnel-devtunnel/src/plugin.ts`](../../../../packages/tunnel-devtunnel/src/plugin.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - the anonymous flag](task-01-the-anonymous-flag.md) | todo | - |
| [02 - a plugin loaded late hears listening](task-02-a-plugin-loaded-late-hears-listening.md) | todo | - |
| [03 - the tunnel says when it fails](task-03-the-tunnel-says-when-it-fails.md) | todo | 01, 02 |
| [04 - a handler that throws raises an alert](task-04-a-handler-that-throws-raises-an-alert.md) | todo | - |

## Risks and tradeoffs

- A plugin written for `listening` once may now get it again after a reload. The reload unloads the old copy first, and it gets `stopping`, so each copy sees one pair.
- `stopping` before the closers changes the order for a plugin with both. The way down already raises `stopping` before the closers, so the order matches.
- Plan [a-plugin-shows-its-state](../20261031-1200-a-plugin-shows-its-state/plan.md) has a defaulted row: a failed `show` only logs. This plan replaces it. That plan has edits from another session that are not committed, so its row is not changed here.
- ahpw's plugin page badge and State fact still read only `state`. That change is ahpw's own, after this merges.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-the-anonymous-flag.md](task-01-the-anonymous-flag.md).
- **Open questions:** none.
- **Watch out for:** `applyNow` is defined before the socket is bound. The event it raises must be the one kept after the first `listening`, at `run.ts:1811`.

## Final verification checklist

- [ ] With anonymous on, `devtunnel access create` gets `-p 31546`, and the tunnel is hosted.
- [ ] Disable then enable the Dev Tunnel plugin with the daemon running: the tunnel comes back, and only one `devtunnel host` runs.
- [ ] A failure to make the tunnel shows an `error` alert on the row, and ahpw's list shows it failing.
- [ ] A handler that throws shows an `error` alert on its plugin's row.
- [ ] `pnpm typecheck`, the `tunnel-devtunnel`, `server` and `sdk` suites, one at a time, and Windows CI pass.
