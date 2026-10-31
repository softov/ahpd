---
title: A plugin shows its state - implemented
date: 2026-10-31
refs:
  - git://c7f7d186 - the commit the work started from; nothing is committed yet
  - "[code://packages/sdk/src/plugins/view.ts](../../../../packages/sdk/src/plugins/view.ts) - the check a view passes"
  - "[code://packages/sdk/src/weburl.ts](../../../../packages/sdk/src/weburl.ts) - the URL rule a canvas and a Link share"
  - "[code://packages/sdk/src/types/plugin.ts](../../../../packages/sdk/src/types/plugin.ts) - `PluginView`, `ViewComponent`, `ViewSurface`, `showView` and `clearView`"
  - "[code://packages/server/src/plugins.ts](../../../../packages/server/src/plugins.ts) - the views the set holds, and the sinks of one load"
  - "[code://packages/server/src/pluginschannel.ts](../../../../packages/server/src/pluginschannel.ts) - `views` on a row, and its translation"
  - "[code://packages/tunnel-devtunnel/src/view.ts](../../../../packages/tunnel-devtunnel/src/view.ts) - `tunnelView` and `sameState`"
  - "[code://packages/tunnel-devtunnel/src/plugin.ts](../../../../packages/tunnel-devtunnel/src/plugin.ts) - the poll, and the page it draws"
  - "[code://docs/plugins/PLUGINS.md](../../../../docs/plugins/PLUGINS.md) - what a view is, and the `views` field of a row"
---

A plugin now sends a view for the surface `main`, and a client draws it on the plugin's page. The row in `x-ahpd-plugins` carries the view as `views`, and the view's words come in the reader's locale. The Dev Tunnel plugin draws its own page. The page shows the tunnel URL as a Link, the tunnel id, the port, the relay state, and the client count.

## What was built

- [`code://packages/sdk/src/types/plugin.ts`](../../../../packages/sdk/src/types/plugin.ts) - `PluginView`, `ViewComponent`, `ViewSurface`, and `showView(view, surface?)` and `clearView(surface?)` on `PluginHost`, next to `alert` and `clearAlert`.
- [`code://packages/sdk/src/plugins/view.ts`](../../../../packages/sdk/src/plugins/view.ts) - `checkView`, which refuses a surface other than `main`, an unknown component kind, a missing child, and a cycle. It also refuses a component with two parents, more than 200 components, more than 64 KiB, and a `{ path }` binding through `literalOf`. It also refuses a Link without an absolute http(s) URL, and an action that names no method of the plugin.
- [`code://packages/sdk/src/weburl.ts`](../../../../packages/sdk/src/weburl.ts) - `isWebUrl`, which the canvas check and the view check both call.
- [`code://packages/server/src/plugins.ts`](../../../../packages/server/src/plugins.ts) - a holding of one view per surface of each plugin, `setView` and `dropView`, and the sinks of a load. A sink drops a call from a host that is not current. `views()` serves a copy, and `viewsChanged` tells the channel.
- [`code://packages/server/src/pluginschannel.ts`](../../../../packages/server/src/pluginschannel.ts) - `views` on the row of a loaded plugin, and `translate`, which reads a Text's `text` and a Link's `label` at `views.<surface>.<componentId>.<prop>`.
- [`code://packages/tunnel-devtunnel/src/devtunnel.ts`](../../../../packages/tunnel-devtunnel/src/devtunnel.ts) - `show(tunnel, runner)`, which reads the URL of port 31546, the host count and the client count.
- [`code://packages/tunnel-devtunnel/src/view.ts`](../../../../packages/tunnel-devtunnel/src/view.ts) - the Card and Column of the plugin's page.
- [`code://packages/tunnel-devtunnel/src/plugin.ts`](../../../../packages/tunnel-devtunnel/src/plugin.ts) - the read at the start, the poll every `POLL_MS`, the one log line of a run of failures, and the clear at `stopping`.
- [`code://packages/tunnel-devtunnel/i18n/pt.json`](../../../../packages/tunnel-devtunnel/i18n/pt.json) and `es.json` - the page's words.
- [`code://docs/plugins/PLUGINS.md`](../../../../docs/plugins/PLUGINS.md) - the calls, the surface, the components, the limits, and `views` in the table of a row.

## Verified

- `packages/sdk/test/plugin-view.test.ts` - 19 cases, all pass.
- `packages/server/test/plugins-channel.test.ts` - 42 cases, 3 of them new, all pass.
- `packages/tunnel-devtunnel/test/tunnel-devtunnel-view.test.ts` - 8 cases, all pass, with `tunnel-devtunnel.test.ts` and `tunnel-devtunnel-options.test.ts` beside it.
- `pnpm -s build`, `pnpm -s typecheck` and `pnpm -s boundary` are clean.
- `pnpm exec vitest run --maxWorkers=6 --testTimeout=20000` from the root, before the review: 8015 tests passed, 29 skipped, 1 failed. The failure was `packages/server/test/plugin-i18n.test.ts > prints nothing on the shipped catalogs`, which `tools/i18n-check.mjs` now accepts. The run raised the timeout because a loaded box turns the machine tests into 5 s timeouts, so `computer-devcontainer` and `computer-disposable` ran and passed here.

## Departures from the plan

- The page has a Text for the name of each value - `Tunnel`, `Port` and `Clients connected` - beside the Text of the value. So a number has a word next to it, and that word can be translated. The plan named a Text for each value only.
- The relay state is two component ids, `relay-up` and `relay-down`, so each word has its own catalog key. The plan named one Text for the state, which a catalog cannot translate in both of its forms.
- `run.ts` reads the views through `views: () => pluginHoldings.views()` rather than keeping a copy, so a row is current with no line after a load or an apply. `viewsChanged` therefore only refreshes the channel.
- `show` reads the counts from a `tunnel` object when the answer wraps them, and from the top level otherwise. The CLI could not be run to see which one it prints.
- The task's hand check was not run: a test daemon with the plugin, and `views.main` read from its row. The `devtunnel` CLI is not on this machine, so the Dev Tunnel page cannot be produced. The channel path it would read is covered by `plugins-channel.test.ts`.
- `tools/i18n-check.mjs` accepts a `views` block. No task named the tool, and Softov chose this on 2026-10-31.
- The review added two fixes. The sdk keeps a copy of a view, so the view kept is the view checked. The Dev Tunnel plugin starts no poll when it stops during the first read.

## Left for later

- The hand check of task 03 on a machine with the `devtunnel` CLI. The fixtures of `show` come from the field names, not from a captured answer.
