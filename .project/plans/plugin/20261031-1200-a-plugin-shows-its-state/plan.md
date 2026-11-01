---
title: A plugin shows its state
domain: plugin
status: active
priority: medium
created: 2026-10-31
revalidated: 2026-10-31
requires: []
changes: []
creates: []
refs:
  - git://cb47945e - the commit of ahpd this plan was checked at, and the last one that holds the brief `.project/briefs/a-plugin-shows-its-state.md`
  - git://cb47945e:.project/briefs/a-plugin-shows-its-state.md - the brief this plan covers
  - "[code://packages/sdk/src/types/plugin.ts#L799-L851](../../../../packages/sdk/src/types/plugin.ts#L799-L851) - `Alert`, `alert` and `clearAlert`, the calls `showView` and `clearView` copy"
  - "[code://packages/sdk/src/types/plugin.ts#L522-L546](../../../../packages/sdk/src/types/plugin.ts#L522-L546) - `PluginMethod`, the command a Button calls"
  - "[code://packages/sdk/src/plugins/plugins.ts#L1184-L1185](../../../../packages/sdk/src/plugins/plugins.ts#L1184-L1185) - the plugin host passes `alert` and `clearAlert` to the loader's sinks"
  - "[code://packages/sdk/src/plugins/plugins.ts#L1488-L1496](../../../../packages/sdk/src/plugins/plugins.ts#L1488-L1496) - `registerMethod`, which keeps the plugin's methods in `contribution.methods`"
  - "[code://packages/sdk/src/host/canvases.ts#L137-L156](../../../../packages/sdk/src/host/canvases.ts#L137-L156) - the canvas check of an absolute http(s) URL, to share with the view check"
  - "[code://packages/server/src/plugins.ts#L1815-L1860](../../../../packages/server/src/plugins.ts#L1815-L1860) - `alerted`, `addAlert` and `dropAlert`, the holding to copy"
  - "[code://packages/server/src/plugins.ts#L1998-L2003](../../../../packages/server/src/plugins.ts#L1998-L2003) - the sinks of one load, which drop what a stale host says"
  - "[code://packages/server/src/plugins.ts#L2107](../../../../packages/server/src/plugins.ts#L2107) - `alerts()`, how the holdings serve what they keep"
  - "[code://packages/server/src/commands/run.ts#L1440-L1448](../../../../packages/server/src/commands/run.ts#L1440-L1448) - `alertsChanged`, which sends the rows again"
  - "[code://packages/server/src/pluginschannel.ts#L234-L280](../../../../packages/server/src/pluginschannel.ts#L234-L280) - `rowOf`, the row in `x-ahpd-plugins`"
  - "[code://packages/server/src/pluginschannel.ts#L315-L339](../../../../packages/server/src/pluginschannel.ts#L315-L339) - `translate`, the row in a reader's locale"
  - "[code://packages/tunnel-devtunnel/src/plugin.ts#L132-L136](../../../../packages/tunnel-devtunnel/src/plugin.ts#L132-L136) - the Dev Tunnel plugin starts `devtunnel host` and says the tunnel id and the port"
  - "[code://packages/tunnel-devtunnel/src/devtunnel.ts#L85-L131](../../../../packages/tunnel-devtunnel/src/devtunnel.ts#L85-L131) - `ok`, `parse` and `find`, the read of a `--json` answer that `show` copies"
  - "[code://docs/plugins/PLUGINS.md#L874](../../../../docs/plugins/PLUGINS.md#L874) - the docs of `alert`"
  - "[code://docs/plugins/PLUGINS.md#L1397-L1412](../../../../docs/plugins/PLUGINS.md#L1397-L1412) - the fields of a row in `x-ahpd-plugins`"
  - npm://@softov/scena@^0.5.16 - the renderer of ahpw; `core/converters/a2ui-v0.10.ts` reads a surface as `A2uiCreateSurface`, `{ root, components, dataModel? }`, and a bound prop as `{ path }`
  - https://a2ui.org/specification/v0_10/ - A2UI v0.10, the component format of a view
---

## Goal

A plugin sends a view for a surface, and a client draws the view there.
A surface is a place where a plugin renders. This plan has one surface, `main`, the plugin's page.
A view is a small A2UI v0.10 surface: Text, Link, Button and a few layout components.
The first view is the Dev Tunnel plugin's state: the tunnel URL, the tunnel id, the port and the relay.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "alert|clearAlert" packages/sdk/src packages/server/src` - the one path a plugin's text takes to its row, and the hook that sends the row again.
- `rg -n "openCanvas|url" packages/sdk/src/host/canvases.ts` - a canvas is a page on a chat with one URL, not a surface of components.
- `rg -n "Text|Link|Button|action" /github/scena/packages/scena/src/core/converters/a2ui-v0.10.ts` - the shape the converter reads, and the `event` action it turns into `surface:event`.
- `devtunnel show <id> --json` - the CLI answers `hostConnections`, `clientConnections` and each port's `portUri`. A relay that is down gives `hostConnections` 0.

### Runtime path

```
plugin: host.showView(view, surface) -> sdk check (view.ts) -> loader sink -> server holdings: viewed[id][surface]
  -> viewsChanged -> pluginLists.refresh() -> x-ahpd-plugins row.views[surface], in the reader's locale
client: draws row.views.main on the plugin's page -> Button -> request { method: action.event.name, params: action.event.context }
  -> host checks the method's grant -> PluginMethod.handle
```

### Gaps

- `PluginHost` has no call that sends more than one sentence.
- The row has no field for a view.
- The Dev Tunnel plugin does not read the URL or the relay state.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A plugin sends a UI schema, and a client draws it on the plugin's page | Softov, the brief: "Softov wants a plugin to send a UI schema, and a client to draw that schema on the plugin's page" | 01 |
| A plugin sends the whole view again on each change, with literal values only | Softov, 2026-10-31: "send the whole now... but wire in a way to make more easy to bind in the future" | 01 |
| A view has the shape of scena's `A2uiCreateSurface` without `dataModel`, so a later plan adds `dataModel` and `{ path }` props with no change of shape | (defaulted: the shape the renderer reads, and the A2UI way to bind) | 01 |
| The sdk reads each prop through one function, which refuses a `{ path }` binding with a rule that says bindings come later | (defaulted: one place to change when bindings come) | 01 |
| A view has these components only: Text, Link, Button, Card, Row, Column, List, Divider and Icon | (defaulted: a small set that each client can draw) | 01 |
| `showView(view, surface)` and `clearView(surface)` on `PluginHost`; `surface` is where the plugin renders, and its default is `main` | Softov, 2026-10-31: "for 1th accept showView(view, surface). surface default main. where the plugin renders" | 01 |
| One view per surface, and a new view replaces the old one on that surface | (defaulted: the same as `alert` and `clearAlert`) | 01 |
| The sdk knows the surface `main` only, and refuses another name until a client has a place for it | (defaulted: a view on a surface that no client draws is lost without a word) | 01 |
| A Link takes an absolute http(s) URL only | (defaulted: the canvas rule for a URL) | 01 |
| A view is at most 200 components and 64 KiB of JSON | (defaulted: a page of state, not a document) | 01 |
| A Button calls a plugin command | Softov, 2026-10-31: "Button calls a plugin command" | 01 |
| The command is an `x-` method this plugin registered, and the Button's `context` is its params | (defaulted: a client sends a normal request, and the host checks the method's grant) | 01 |
| The views are a field `views` on the row in `x-ahpd-plugins`, a map from the surface to its view, sent again on each change | (defaulted: the path an alert takes) | 02 |
| A reload or an unload removes the views | (defaulted: the same as alerts) | 02 |
| The `text` of a Text and the `label` of a Link are translated at `views.<surface>.<componentId>.<prop>` in the plugin's catalogs | (defaulted: the keys `translate` reads for the title and the form) | 02 |
| The view's English follows the writing rules of [the-text-a-person-reads-is-plain.md](../../../briefs/the-text-a-person-reads-is-plain.md), and its `pt` and `es` are translated from it | Softov, 2026-10-31, chose "Brief for all plugin text" | 03 |
| The Dev Tunnel plugin reads its state from `devtunnel show <id> --json`, once at the start and then every 30 seconds | Softov, 2026-10-31, chose "Poll show --json" | 03 |
| The relay is down when `hostConnections` is 0; the URL is the `portUri` of the tunnel's port | (defaulted: the fields the CLI answers) | 03 |
| The view also shows the count of connected clients | (defaulted: `show` answers it with no extra call) | 03 |
| A `show` that fails keeps the last view, and the plugin logs the first failure of a run of them | (defaulted: a short network loss does not empty the page or fill the log) | 03 |
| `tools/i18n-check.mjs` accepts a `views` block and checks its shape: surface, component id, then `text` or `label` as a string | Softov, 2026-10-31: "Checker accepts views" | 03 |
| The sdk keeps a copy of a view, so a later change to the plugin's object does not reach the row | (defaulted: the view kept is the view checked) | 01 |
| ahpw draws the view first, in its own plan; ahpapp and ahpc come later | (defaulted: ahpw is the only client that reads `x-ahpd-plugins`) | - |

## Proposed architecture

- **Data flow** - the plugin gives a view; the sdk checks it; the server holds it per plugin and serves it on the row.
- **Event flow** - a new or cleared view calls `viewsChanged`, which refreshes the plugins channel. A Button is a normal request from the client.
- **State flow** - the server holds at most one view per surface of each plugin, in memory, keyed by the plugin id and the surface.
- **Layer responsibilities** - `sdk` has the type, the calls and the check; `server` holds, serves and translates; `tunnel-devtunnel` makes the first view. docs: `PLUGINS.md`.
- **Source-of-truth files** - [`code://packages/sdk/src/types/plugin.ts`](../../../../packages/sdk/src/types/plugin.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A plugin gives a view](task-01-a-plugin-gives-a-view.md) | implemented | - |
| [02 - The row carries the view](task-02-the-row-carries-the-view.md) | implemented | 01 |
| [03 - Dev Tunnel shows its state](task-03-dev-tunnel-shows-its-state.md) | implemented | 02 |

## Risks and tradeoffs

- A relay that drops shows in the view up to 30 seconds late.
- Each poll is one `devtunnel show` process and one request to the Dev Tunnels service.
- A view sent on each change sends the row again to each client that watches. The relay and the client count change rarely, so the cost is small.
- A Button sends the command with the grant of the person who clicks it. A person without the grant gets the host's refusal.

## Resume state

- **Done so far:** the three tasks were implemented on 2026-10-31. [implemented.md](implemented.md) says what exists now.
- **Next action:** PR #175 merged. The hand check of task 03 waits in [pending/plugin-view-checks.md](../../../pending/plugin-view-checks.md). Then a review.
- **Open questions:** none.
- **Watch out for:** the `devtunnel` CLI was not on this machine. So the fixtures of `show` are built from the field names, not from captured answers.

## Final verification checklist

- [ ] The Dev Tunnel row in `x-ahpd-plugins` carries `views.main`.
- [ ] The view shows the tunnel URL as a Link, the tunnel id, the port, the relay state and the client count.
- [ ] A relay that closes and comes back changes the view within 30 seconds, and a client that watches gets the row again.
- [ ] The sdk refuses a view with an unknown component, a missing child, a cycle, a bad URL or an unknown method.
- [ ] The sdk refuses a binding and an unknown surface.
- [ ] Each refusal names the rule.
- [ ] A reload removes the views, and a disabled plugin has none.
- [ ] A view's texts come in Portuguese for a client that sends `pt`, when the plugin's catalog has them.
- [ ] `pnpm typecheck` and the sdk, server and tunnel-devtunnel suites pass, and Windows CI is green.
