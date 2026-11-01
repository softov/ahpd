---
title: A plugin that fails says so
created: 2026-10-31
refs:
  - git://47d14247 - the commit of ahpd the facts were checked at
  - git://2ed435cc - the commit of ahpw the facts were checked at
  - "[code://packages/tunnel-devtunnel/src/devtunnel.ts#L209-L224](../../packages/tunnel-devtunnel/src/devtunnel.ts#L209-L224) - `prepare`, which runs `access create` with `--port`, a flag the CLI does not know"
  - "[code://packages/tunnel-devtunnel/test/tunnel-devtunnel.test.ts#L131](../../packages/tunnel-devtunnel/test/tunnel-devtunnel.test.ts#L131) - the test that expects `--port`"
  - "[code://packages/tunnel-devtunnel/src/plugin.ts#L144-L180](../../packages/tunnel-devtunnel/src/plugin.ts#L144-L180) - the `listening` handler, which catches each failure and calls only `plugin.log`"
  - "[code://packages/tunnel-devtunnel/src/plugin.ts#L119-L128](../../packages/tunnel-devtunnel/src/plugin.ts#L119-L128) - `read`, which logs the first failed `show` of a run"
  - "[code://packages/tunnel-devtunnel/src/devtunnel.ts#L239-L251](../../packages/tunnel-devtunnel/src/devtunnel.ts#L239-L251) - `host`, which logs a spawn error and has no `exit` listener"
  - "[code://packages/sdk/src/plugins/plugins.ts#L1834-L1863](../../packages/sdk/src/plugins/plugins.ts#L1834-L1863) - `raise`, which gives a handler that throws to `onProblem`"
  - "[code://packages/server/src/commands/run.ts#L1811-L1821](../../packages/server/src/commands/run.ts#L1811-L1821) - `listening` is raised with `stamp` as its `onProblem`"
  - "[code://packages/server/src/commands/run.ts#L1954](../../packages/server/src/commands/run.ts#L1954) - `stopping` is raised with `stamp` as its `onProblem`"
  - "[code://packages/server/src/commands/run.ts#L309](../../packages/server/src/commands/run.ts#L309) - `stamp`, one line on stderr"
  - "[code://packages/server/src/plugins.ts#L2278-L2364](../../packages/server/src/plugins.ts#L2278-L2364) - `describePlugin`, which gives `ready` from the configuration and the manifest, with no import"
  - "[code://packages/sdk/src/types/plugin.ts#L789-L807](../../packages/sdk/src/types/plugin.ts#L789-L807) - `Alert`, with a `level`, a `text` and a `ref`"
  - "[code://packages/sdk/src/types/plugin.ts#L895-L910](../../packages/sdk/src/types/plugin.ts#L895-L910) - `alert` and `clearAlert` on `PluginHost`"
  - "[code://packages/activepieces/src/plugin.ts#L341-L345](../../packages/activepieces/src/plugin.ts#L341-L345) - a plugin that raises an `error` alert with a `ref`, and replaces it on success"
  - "[code://docs/plugins/PLUGINS.md#L874](../../docs/plugins/PLUGINS.md#L874) - the docs of `alert`"
  - https://github.com/softov/ahpw/blob/2ed435cc83d63f569a8bba9596dd243a0347f2b4/src/resources/plugins/rows.ts#L80-L85 - the plugin list, where an `error` alert turns the row to failing
  - https://github.com/softov/ahpw/blob/2ed435cc83d63f569a8bba9596dd243a0347f2b4/src/resources/plugins/PluginPage.tsx#L55 - the plugin page badge, which reads only `state`
  - https://github.com/softov/ahpw/blob/2ed435cc83d63f569a8bba9596dd243a0347f2b4/src/resources/plugins/Overview.tsx#L35 - the State fact, which reads only `state`
---

# A plugin that fails says so

Softov wants a plugin that fails after it loads to say so on its page, as an alert and in its state.
Today the Dev Tunnel plugin can fail to make its tunnel, and its page still says Ready with no alert.
The failure is only a line in the daemon's log.

## What others do

The change follows the activepieces plugin in this repository ([`code://packages/activepieces/src/plugin.ts`](../../packages/activepieces/src/plugin.ts#L341-L345)).
It raises an `error` alert with a `ref` when an install fails.
When the install works, an `info` alert with the same `ref` replaces it.

## What ahpd has today

- The failure that Softov saw: `prepare` runs `devtunnel access create <id> --anonymous --port 31546` ([`code://packages/tunnel-devtunnel/src/devtunnel.ts`](../../packages/tunnel-devtunnel/src/devtunnel.ts#L209-L224)).
- The Dev Tunnels CLI 1.0.2094 has no `--port` on `access create`. Its flag is `-p, --port-number`, and it answers "Unrecognized command or argument '--port'".
- The test expects `--port`, so the suite passes with the wrong flag ([`code://packages/tunnel-devtunnel/test/tunnel-devtunnel.test.ts`](../../packages/tunnel-devtunnel/test/tunnel-devtunnel.test.ts#L131)).
- The `listening` handler catches each failure and calls only `plugin.log` ([`code://packages/tunnel-devtunnel/src/plugin.ts`](../../packages/tunnel-devtunnel/src/plugin.ts#L144-L180)). This covers a tunnel it cannot find, make or prepare, and a port 31546 it cannot listen on.
- `host` logs a spawn error of `devtunnel host`. It has no `exit` listener, so a host process that ends says nothing ([`code://packages/tunnel-devtunnel/src/devtunnel.ts`](../../packages/tunnel-devtunnel/src/devtunnel.ts#L239-L251)).
- `read` logs the first failed `devtunnel show` of a run, and keeps the last view ([`code://packages/tunnel-devtunnel/src/plugin.ts`](../../packages/tunnel-devtunnel/src/plugin.ts#L119-L128)).
- A handler that throws is caught by `raise`, which gives one line to `onProblem` ([`code://packages/sdk/src/plugins/plugins.ts`](../../packages/sdk/src/plugins/plugins.ts#L1834-L1863)).
- For `listening` and `stopping`, `onProblem` is `stamp`, one line on stderr ([`code://packages/server/src/commands/run.ts`](../../packages/server/src/commands/run.ts#L1811-L1821)). No alert reaches the row.
- The row's `state` comes from `describePlugin`, which reads the configuration and the manifest with no import ([`code://packages/server/src/plugins.ts`](../../packages/server/src/plugins.ts#L2278-L2364)). `ready` means that the plugin is configured right, not that it works.
- `alert` and `clearAlert` already put an alert on the row and take it off ([`code://packages/sdk/src/types/plugin.ts`](../../packages/sdk/src/types/plugin.ts#L895-L910)).

## What ahpw has today

- The plugin list shows a row with an `error` alert as failing, over its configured state ([`rows.ts`](https://github.com/softov/ahpw/blob/2ed435cc83d63f569a8bba9596dd243a0347f2b4/src/resources/plugins/rows.ts#L80-L85)).
- The plugin page badge reads only `state` ([`PluginPage.tsx`](https://github.com/softov/ahpw/blob/2ed435cc83d63f569a8bba9596dd243a0347f2b4/src/resources/plugins/PluginPage.tsx#L55)).
- The State fact on Overview reads only `state` ([`Overview.tsx`](https://github.com/softov/ahpw/blob/2ed435cc83d63f569a8bba9596dd243a0347f2b4/src/resources/plugins/Overview.tsx#L35)).
- So a plugin with an `error` alert is failing in the list and Ready on its page.

## Who writes

| Writer | What the change does to it |
|---|---|
| Open pull requests of ahpd and ahpw | None. |
| Fork branches of ahpd | `maycxc/plugin/54-webhook-real-senders` and two `maycxc/union-2026-10-30-*` branches change `docs/plugins/PLUGINS.md`. A change to the `alert` docs may conflict with them. No fork branch touches `packages/tunnel-devtunnel`. |
| Branches of ahpw | No branch that is not in main touches `src/resources/plugins`. |
| [a-plugin-shows-its-state](../plans/plugin/20261031-1200-a-plugin-shows-its-state/plan.md) | Merged and waiting on review. It wrote the view of the Dev Tunnel plugin in the same file. Its answer says that a failed `show` only logs. |
| Another session in this checkout | It has changes to that plan and to [the-text-a-person-reads-is-plain.md](the-text-a-person-reads-is-plain.md) that are not committed. The words of a new alert follow that brief. |

## The change

- `prepare` passes `-p` to `access create`, as it does to `port create`. The test expects `-p`.
- The Dev Tunnel plugin raises an `error` alert with a `ref` when it cannot make, prepare or host its tunnel, or cannot listen on 31546.
- `host` listens for the exit of `devtunnel host`. An exit that the plugin did not ask for raises the same kind of alert.
- The plugin clears the alert when the tunnel is hosted.
- The daemon raises an `error` alert on a plugin's row when one of its handlers throws, as well as the line on stderr.
- ahpw's plugin page badge and its State fact show failing when the row has an `error` alert, with the words the list uses.

## Open points

- Does a failed `devtunnel show` raise a `warning` alert? The plan [a-plugin-shows-its-state](../plans/plugin/20261031-1200-a-plugin-shows-its-state/plan.md) answered that it only logs.
- Is failing a value that clients work out from the alerts, as the list does now, or a field that ahpd sends on the row? `state` keeps its meaning either way: what the configuration says.
- Does the Dev Tunnel plugin try again after a failure, or only when a person reloads it?
