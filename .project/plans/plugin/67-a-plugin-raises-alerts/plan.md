---
title: A plugin raises alerts, and its row carries them
domain: plugin
status: built
priority: medium
created: 2026-10-25
revalidated: 2026-10-25
requires: []
refs:
  - "[code://packages/sdk/src/types/plugin.ts#L761-L773](../../../../packages/sdk/src/types/plugin.ts#L761-L773) - `problem(line)`, the one way a plugin reports an item it dropped today"
  - "[code://packages/server/src/plugins.ts#L1339](../../../../packages/server/src/plugins.ts#L1339) - a `problem` line is collected while `apply` runs and logged after it"
  - "[code://packages/server/src/plugins.ts#L1737-L1741](../../../../packages/server/src/plugins.ts#L1737-L1741) - only the last line of a failed load is kept by plugin id"
  - "[code://packages/server/src/applyplugins.ts#L94-L97](../../../../packages/server/src/applyplugins.ts#L94-L97) - the lines of a load that worked go to the daemon log only"
  - "[code://packages/server/src/pluginschannel.ts#L70-L82](../../../../packages/server/src/pluginschannel.ts#L70-L82) - `loadProblemOf`, the masking every alert text gets"
  - "[code://packages/server/src/pluginschannel.ts#L234-L252](../../../../packages/server/src/pluginschannel.ts#L234-L252) - the row and its `loadProblem`"
  - "[code://docs/plugins/PLUGINS.md#L809-L815](../../../../docs/plugins/PLUGINS.md#L809-L815) - the docs of `problem(line)`"
  - "[code://docs/plugins/PLUGINS.md#L1265-L1276](../../../../docs/plugins/PLUGINS.md#L1265-L1276) - the table of row fields"
  - file:///github/ahpw/src/resources/plugins/Overview.tsx - ahpw reads `loadProblem` today
---

## Goal

Every plugin can raise an alert, and a client shows it on the plugin's page.
An alert has a level, a text and a reference to what it is about. The reference names one agent, bot, computer or piece of the plugin.
Today a piece that Activepieces cannot load is only a line in the daemon log, and the plugin page says "Pronto".

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "problem\(" packages/sdk/src packages/server/src` - `host.problem` is collected in `loadOne` and logged once the load answers.
- `rg -n "loadProblem" packages docs /github/ahpw/src` - the row field is written in `pluginschannel.ts`, documented in `PLUGINS.md`, tested in `plugins-channel.test.ts`, and read by ahpw's `Overview.tsx` and `rows.ts`.
- `rg -n "failed\.set|failed\.delete" packages/server/src/plugins.ts` - the plugin set keeps one failure line by id, and clears it on a load that works and on unload.

### Runtime path

```
host.alert / host.problem / a loader line -> plugin set, alerts by id -> x-ahpd/plugins row `alerts` -> ahpw plugin page
```

### Gaps

- A line about a load that worked reaches no client.
- A line said after `apply` returns goes only to the log.
- A row has no level and no reference for what went wrong.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The row carries `alerts: []`, not a list of problems, so it can carry more than problems | Softov, 2026-10-25: "I think a alerts: [] its better... so it can carry more than problems" | 01 |
| An alert has one of four levels: `notice`, `info`, `warning` and `error` | Softov, 2026-10-25: "for now" | 01 |
| Every plugin can raise an alert, and its reference names the agent, bot, computer or other item of that plugin | Softov, 2026-10-25: "the plugin gets a alert... automatically every plugin will be able to alert things" | 01 |
| A problem is an `error` or a `warning` by what it is: an item that does not load while the rest do is a `warning`, and a plugin that does not load is an `error` | Softov, 2026-10-25 | 01 |
| `loadProblem` becomes an alert, and the row no longer carries `loadProblem` | Softov, 2026-10-25; (defaulted: the host sends the new field only, as plan 62 did with `ready`) | 01 |
| An alert is `{ level, text, ref? }`, and `ref` is a string the plugin writes as `<kind>:<id>`, such as `adapter:ap-postgres` | (defaulted: one plain field a client can show or match on) | 01 |
| `host.alert(alert)` raises one. An alert with the same `ref` replaces the one before it, and `host.clearAlert(ref)` takes it out | (defaulted: plan 68 shows an install that ends or fails in the same place) | 01 |
| `host.problem(line)` stays, and raises a `warning` alert with no `ref` | (defaulted: every plugin that says a problem today shows it with no change) | 01 |
| A loader line about a plugin is a `warning`, and the line that says a plugin did not load is an `error` | (defaulted: from the answer on levels) | 01 |
| An alert raised after `apply` returns is on the row at once, and the channel sends the row again | (defaulted: plan 68 raises alerts after load) | 01 |
| A reload or an unload clears the plugin's alerts | (defaulted: as the failure line is cleared today) | 01 |
| Every alert text is masked as `loadProblem` is: the userinfo of a URL and each `writeOnly` option value | (defaulted: no row carries a secret) | 01 |
| A plugin holds at most 50 alerts, and the oldest goes first | (defaulted: a plugin that alerts in a loop cannot grow the row) | 01 |
| ahpw's change is its own work, for session c7 | (defaulted: each repository keeps its own plans) | - |

## Proposed architecture

- **Data flow** - a plugin, or the loader for it, adds an alert to the plugin set under the plugin's id; the channel row reads it.
- **Event flow** - an alert raised after load calls the plugins channel `refresh`, so a client gets the row again.
- **State flow** - the alerts live in memory, by plugin id, and go on reload, unload and restart.
- **Layer responsibilities** - sdk: the `Alert` type, `PluginHost.alert`, `clearAlert` and the `problem` mapping.
  server: the alerts by id, the row field, the masking and the refresh. docs: `PLUGINS.md`.
- **Source-of-truth files** - [`code://packages/server/src/plugins.ts`](../../../../packages/server/src/plugins.ts), [`code://packages/server/src/pluginschannel.ts`](../../../../packages/server/src/pluginschannel.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A plugin row carries its alerts](task-01-a-plugin-row-carries-its-alerts.md) | done | - |

## Risks and tradeoffs

- An ahpw from before its change shows no failure line, because `loadProblem` goes. The ahpw change ships with this plan.
- A plugin can write any text in an alert. The masking covers the secrets the host knows of, and not a secret the plugin makes up.

## Resume state

- **Done so far:** [task-01](task-01-a-plugin-row-carries-its-alerts.md) is implemented. The sdk has `Alert`, `alert` and `clearAlert`. The plugin set keeps the alerts by id. The row carries `alerts`, masked, and no `loadProblem`.
- **Next action:** none. The plan is built, and `implemented.md` says what exists.
- **Open questions:** none.
- **Watch out for:** `row.problem` is a different field, and it stays: it is the config problem of the spec. A plugin's `problem` line is still printed by `ahpd start` as `skipped:`, and it is also a `warning` alert on the row. One raised after `apply` returned is on the row and in the log.

## Final verification checklist

- [ ] With a piece name that does not exist in the Activepieces options, the row carries one `warning` alert that names the piece.
- [ ] A plugin that throws in `apply` has one `error` alert and no `loadProblem`.
- [x] `plans/index.md` updated.
