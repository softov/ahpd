---
title: A connector and an agent show a view
domain: plugin
status: planned
priority: medium
created: 2026-11-06
revalidated: 2026-11-06
requires:
  - plans/claude/20261104-2255-a-turn-says-its-context-and-plan-limits/plan.md
refs:
  - git://ce0bac32 - the commit of ahpd this plan was checked at, after #245 and #247
  - git://ce0bac32 - the last commit that holds `.project/briefs/a-connector-shows-a-view.md`, the brief this plan covers
  - git://e32a85aa - the head of #248's branch, whose check, handle and channel work this plan reuses
  - plans/plugin/20261105-0520-a-connector-and-an-agent-show-a-ui/plan.md - the plan this one replaces, which #248 built
  - plans/plugin/20261031-1200-a-plugin-shows-its-state/plan.md - the plugin view, the one structure this plan extends
  - plans/plugin/53-a-client-sees-plugins-and-connectors/plan.md - the capability types, with `ui` reserved
  - "[code://packages/sdk/src/types/plugin.ts#L810-L866](../../../../packages/sdk/src/types/plugin.ts#L810-L866) - `ViewSurface`, `ViewComponent` and `PluginView`, with no data model"
  - "[code://packages/sdk/src/types/plugin.ts#L943-L963](../../../../packages/sdk/src/types/plugin.ts#L943-L963) - `showView` and `clearView` on the plugin host"
  - "[code://packages/sdk/src/plugins/view.ts#L41-L187](../../../../packages/sdk/src/plugins/view.ts#L41-L187) - `literalOf`, which refuses `{ path }`, and `checkView`"
  - "[code://packages/server/src/plugins.ts#L1922-L1935](../../../../packages/server/src/plugins.ts#L1922-L1935) - `setView` and `dropView`, which keep views by plugin and surface"
  - "[code://packages/server/src/pluginschannel.ts#L96-L130](../../../../packages/server/src/pluginschannel.ts#L96-L130) - `shownIn`, a plugin view's text in the reader's locale"
  - "[code://packages/server/src/pluginschannel.ts#L306-L336](../../../../packages/server/src/pluginschannel.ts#L306-L336) - the plugin row carries `views`, by surface"
  - "[code://packages/sdk/src/resources/recordschannel.ts#L207-L262](../../../../packages/sdk/src/resources/recordschannel.ts#L207-L262) - `send` and `apply`, the one road for `added`, `changed` and `removed` on every records channel"
  - "[code://packages/sdk/src/types/connectors.ts#L28-L56](../../../../packages/sdk/src/types/connectors.ts#L28-L56) - `CapabilityType`, with `ui` reserved, and `Capability`"
  - "[code://packages/sdk/src/types/connectors.ts#L447-L500](../../../../packages/sdk/src/types/connectors.ts#L447-L500) - `Adapter` and `open(connector)`"
  - "[code://packages/sdk/src/types/agents.ts#L105-L151](../../../../packages/sdk/src/types/agents.ts#L105-L151) - `Engine`, with no capabilities, and `open(record)`"
  - "[code://packages/sdk/src/connectors/channel.ts#L399](../../../../packages/sdk/src/connectors/channel.ts#L399) - the connector row"
  - "[code://packages/sdk/src/agents/channel.ts#L300](../../../../packages/sdk/src/agents/channel.ts#L300) - the agent row, the same shape"
  - "[code://docs/plugins/PLUGINS.md#L1011-L1032](../../../../docs/plugins/PLUGINS.md#L1011-L1032) - the plugin view, as plugin authors read it"
  - npm://@softov/scena@0.5.18 - `surface:open` takes a view with its `dataModel`, `surface:update` sets a `value` at a `path`, and `surface:delete` removes the view
---

## Goal

A connector and an agent show views, as a plugin shows views on its page.
It is one structure with one name, `view`, for a plugin, a connector and an agent.
A view belongs to its record, so two connectors of one adapter can show different views.
A record shows a view on a surface. `main` is the one surface now, and the type leaves room for more.
Every view takes an A2UI data model, the plugin's own page included.
The plugin sends events: one replaces a view, one sets a value of its data, and one removes it.
The first users are agent-claude and devtunnel.
agent-claude shows plan usage on a `claude-login` connector and on a Claude agent.
devtunnel shows its account on its connector.

## How it works

A plugin makes the same three calls for its own page and for a record:

| Call | What it does |
| --- | --- |
| `showView(view, surface?)` | Replaces the view on the surface, with its data model. |
| `setViewData(path, value, surface?)` | Sets one value of the view's data model. A path of `/` replaces the whole model. |
| `clearView(surface?)` | Removes the view from the surface. |

The plugin's page has the calls on its host, as `showView` and `clearView` are today.
A connector or an agent gets the calls on a handle that `open` hands the plugin.
The handle names only that record.

```ts
registerAdapter({
  name: 'claude-login',
  capabilities: [{ type: 'view', name: 'main', title: 'Plan usage', description: 'What is left of each window.' }],
  open: (connector, view) => {
    view?.showView({
      root: 'plan',
      components: { plan: { id: 'plan', component: 'Text', text: { path: '/plan' } } },
      dataModel: { plan: 'max' },
    });
    // When the account answers again:
    view?.setViewData('/plan', 'pro');
  },
});
```

The `view` capability says which surfaces a record of the adapter or the engine may show.
It carries no components.
A client reads it to know that a connector of this adapter shows a view, before the first event comes.

A client gets a view and its data like this:

- The plugin row, the connector row and the agent row carry `views`, by surface: `{ main: { root, components, dataModel } }`. A new subscriber reads the current view and data there.
- `showView` and `clearView` send the changed row, as a plugin view does today.
- `setViewData` sends one action, `<scheme>/viewData` `{ id, surface, path, value }`, to each reader of that record. It does not send the row again.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "showView|clearView|ViewSurface" packages/sdk/src packages/server/src` - the plugin host, the server's `setView` and `dropView`, and the plugin row.
- `rg -n "recordsChannel\(" packages` - the plugins, connectors and agents channels all use `recordsChannel`, so one new action serves all three.
- `rg -n "surface:update" /github/scena/packages/scena/src` - scena sets a value at a path, or replaces the view.
- `rg -n "quotaSnapshots|health\.account" /github/ahpw/src /github/ahpapp/src /github/ahpc/src` - no client reads the plan fields of the connector health.

### Runtime path

```
plugin: showView / setViewData / clearView, on its host or on a record's handle
-> the host checks the view, keeps it by plugin or record and surface
-> showView, clearView: the row is sent again with `views`
-> setViewData: `<scheme>/viewData` goes to the readers of that record
-> a client draws the view with scena: surface:open, surface:update, surface:delete
```

### Gaps

- A view has no data model, and `literalOf` refuses every `{ path }`.
- A connector and an agent have no views, and `open` hands them no handle.
- An engine has no `capabilities` list.
- No records channel sends an action other than `added`, `changed` and `removed`.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A plugin, a connector and an agent use one structure with one name, `view`: the calls, the row field and the capability type | Softov, 2026-11-06: "I think we need to use only one naming also. I think the whole problem was creating another thing. Another name."; chose "view everywhere" | 01, 02 |
| A view belongs to its record, and one record can show different views on different surfaces | Softov, 2026-11-06: "It was suppose to be with the record. a connector at the same component could register diff ui." | 02 |
| `main` is the one surface now, with room for more later | Softov, 2026-11-06: "It was suppose to be a plan to register a 'main' view initially. with space to register more in the future." | 02 |
| The plugin sends events that change the view or its data | Softov, 2026-11-06: "Send events to update it or its data." | 03 |
| Every view takes an A2UI data model, the plugin's own page included, and a prop may bind to `{ path }` | Softov, 2026-11-06, chose "Yes, for every surface" | 01 |
| The data model is inside `PluginView`, as scena's surface has it, so `showView` replaces the components and their data in one event | Softov, 2026-11-06, chose "Inside the view" | 01 |
| The calls are `showView(view, surface?)`, `setViewData(path, value, surface?)` and `clearView(surface?)`, on the plugin host and on a record's handle | Softov, 2026-11-06, chose `setViewData`; `showView` and `clearView` are the plugin host's own | 02, 03 |
| A data event sets one value at a path, and a path of `/` replaces the whole model | Softov, 2026-11-06, chose "A value at a path" | 03 |
| A data event travels as its own action, and does not send the row again | Softov, 2026-11-06, chose "Events on their own" | 03 |
| The `view` capability names the surfaces that a record of the adapter or the engine may show, and the host refuses a view on another surface | Softov, 2026-11-06, chose "It names the surfaces" | 02 |
| An engine gets the same `capabilities` list as an adapter | Softov, 2026-11-05, chose "Engines get capabilities too" | 02 |
| `open` hands the plugin a handle that names only that record | Softov, 2026-11-02, chose "A handle from open" | 02 |
| A connector and an agent work the same way, in one plan | Softov, 2026-11-05: "BOTH must work at the same time and at the same way basically." | 02 |
| The plugin chooses what each record shows; the host does not join rows | Softov, 2026-11-05: "the agent choose what info to advertise from the connector. same for the tunnel.. A agent X can list info, while agent Y show only a number" | 04, 05 |
| The first users are `claude-login` and devtunnel | Softov, 2026-11-05, chose "claude-login and devtunnel" | 04, 05 |
| A Claude agent's view shows its logins' plan usage | Softov, 2026-11-05, chose "Its logins' plan usage" | 04 |
| The handle is `ViewHandle`, the three calls of the plugin host | (defaulted: one name; the type names what it holds) | 02 |
| A record's view is checked by `checkView`, as a plugin's view is, and a Button's event names a method of the same plugin | (defaulted: one structure, one check) | 01, 02 |
| A view with its data model is at most 64 KiB of JSON, and a `setViewData` that passes it is refused | (defaulted: the plugin view's limit) | 01, 03 |
| A `setViewData` on a surface with no view is refused, and the refusal goes to the problem log | (defaulted: no data without a view to draw it) | 03 |
| The action is `<scheme>/viewData` `{ id, surface, path, value }` | (defaulted: the `<scheme>/<what>` form of `added`, `changed` and `removed`) | 03 |
| A close, a removal or an unload removes a record's views, and an old handle writes nothing | (defaulted: as #248 built it) | 02 |
| A record's view text is sent as the plugin wrote it; a plugin's view stays in the reader's locale | (defaulted: no adapter or engine row is translated today; see `deferred.md`) | - |
| The plan fields of the connector health go; plan usage travels in the view | (defaulted: one copy of a fact) | 04 |

## Proposed architecture

- **Data flow** - A view, with its data model, travels on the row of its plugin, connector or agent, in `views`, by surface. A data event travels as `<scheme>/viewData`.
- **Event flow** - The plugin calls `showView`, `setViewData` or `clearView`. The host checks the call, changes what it keeps, and sends the row or the action.
- **State flow** - The host keeps each view in memory, by plugin or record and then by surface. A close, a removal, a reload or an unload removes it.
- **Layer responsibilities** - sdk: the types, the check, the handle, the rows and the action. server: the plugin host's calls and its row. Each plugin: its own views.
- **Source-of-truth files** - [`code://packages/sdk/src/plugins/view.ts`](../../../../packages/sdk/src/plugins/view.ts) for the check, [`code://packages/sdk/src/types/plugin.ts`](../../../../packages/sdk/src/types/plugin.ts) for `PluginView` and `ViewHandle`.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - a view takes a data model](task-01-a-view-takes-a-data-model.md) | todo | - |
| [02 - a record shows its views](task-02-a-record-shows-its-views.md) | todo | 01 |
| [03 - a data event sets a value](task-03-a-data-event-sets-a-value.md) | todo | 02 |
| [04 - claude shows plan usage](task-04-claude-shows-plan-usage.md) | todo | 03 |
| [05 - devtunnel shows its account](task-05-devtunnel-shows-its-account.md) | todo | 03 |
| [06 - the docs say how a view is made](task-06-the-docs-say-how-a-view-is-made.md) | todo | 03 |

## Risks and tradeoffs

- The build reworks #248's branch, so its `ui` names must all go. Task 02 removes each one, and a search for them must find nothing.
- A binding to a path the data does not hold draws nothing. The check cannot see the data, so the docs say this, and each user's tests send full data.
- A client that does not know `<scheme>/viewData` shows the old value until the next row. ahpw handles the action in a plan of its own.

## Resume state

- **Done so far:** nothing. #248's branch holds the work of the replaced plan.
- **Next action:** [task-01-a-view-takes-a-data-model.md](task-01-a-view-takes-a-data-model.md).
- **Open questions:** none.
- **Watch out for:** a plugin, a connector and an agent must stay one structure. A change to one needs the same change to the others.

## Final verification checklist

- [ ] A plugin's view takes a data model, and a prop bound to `{ path }` passes the check.
- [ ] A connector and an agent show a view on `main` from the handle that `open` hands them, and the row carries it in `views`.
- [ ] A view on a surface that the `view` capability does not name is refused.
- [ ] `setViewData` sends `<scheme>/viewData` to each reader of the record, and the row is not sent again.
- [ ] A close, a removal or an unload removes the views, and an old handle writes nothing.
- [ ] A `claude-login` connector and a Claude agent show plan usage, and a devtunnel connector shows its account.
- [ ] No `ui` name of #248 is left: `UiSchema`, `UiComponent`, `UiHandle`, `checkUi`, `Capability.ui` and the row's `ui`.
- [ ] `pnpm typecheck`, `pnpm boundary`, and the sdk, server, agent-claude and tunnel-devtunnel tests pass.
