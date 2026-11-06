---
title: A connector and an agent show a ui
domain: plugin
status: planned
priority: medium
created: 2026-11-05
revalidated: 2026-11-05
requires:
  - plans/claude/20261104-2255-a-turn-says-its-context-and-plan-limits/plan.md
refs:
  - git://90ee5548 - the commit of ahpd this plan was checked at, after #240 to #244
  - git://a8eff676 - the last commit that holds `.project/briefs/a-connector-shows-a-view.md`, the brief this plan covers
  - "[code://packages/sdk/src/types/connectors.ts#L27](../../../../packages/sdk/src/types/connectors.ts#L27) - the capability type `ui`, reserved for a component tree"
  - "[code://packages/sdk/src/types/connectors.ts#L447-L520](../../../../packages/sdk/src/types/connectors.ts#L447-L520) - `Adapter`, with `capabilities` and `open(connector)`"
  - "[code://packages/sdk/src/types/agents.ts#L105-L151](../../../../packages/sdk/src/types/agents.ts#L105-L151) - `Engine`, which has no capabilities, and `open(record)`"
  - "[code://packages/sdk/src/plugins/view.ts#L41-L54](../../../../packages/sdk/src/plugins/view.ts#L41-L54) - `literalOf`, the one function that changes when bindings arrive, and `checkView`"
  - "[code://packages/sdk/src/plugins/validate.ts#L801-L860](../../../../packages/sdk/src/plugins/validate.ts#L801-L860) - `checkAdapter`, which checks each capability at registration"
  - "[code://packages/sdk/src/plugins/plugins.ts#L1928-L1946](../../../../packages/sdk/src/plugins/plugins.ts#L1928-L1946) - `registerAdapter` and `registerEngine`"
  - "[code://packages/sdk/src/connectors/adapters.ts#L52-L81](../../../../packages/sdk/src/connectors/adapters.ts#L52-L81) - the adapter row on `x-ahpd-adapters`, which sends the capabilities whole"
  - "[code://packages/sdk/src/agents/engines.ts#L26](../../../../packages/sdk/src/agents/engines.ts#L26) - the engine row on `x-ahpd-engines`"
  - "[code://packages/sdk/src/connectors/channel.ts#L342-L422](../../../../packages/sdk/src/connectors/channel.ts#L342-L422) - the connector health, kept in memory by id, with the plan limits and the account #243 added, and the connector row"
  - "[code://packages/sdk/src/agents/channel.ts#L233-L309](../../../../packages/sdk/src/agents/channel.ts#L233-L309) - the agent health, kept in memory by id, and the agent row; the same shape"
  - "[code://packages/server/src/pluginschannel.ts#L103-L132](../../../../packages/server/src/pluginschannel.ts#L103-L132) - `shownIn`, a plugin view's text in the reader's locale; an adapter or engine row has no such step"
  - "[code://packages/agent-claude/src/plugin.ts#L203-L204](../../../../packages/agent-claude/src/plugin.ts#L203-L204) - agent-claude registers the `claude-login` adapter and the Claude engine"
  - "[code://packages/tunnel-devtunnel/src/plugin.ts#L178](../../../../packages/tunnel-devtunnel/src/plugin.ts#L178) - devtunnel registers its adapter"
  - "[code://docs/plugins/PLUGINS.md#L572-L700](../../../../docs/plugins/PLUGINS.md#L572-L700) - an adapter and its capabilities, as plugin authors read it"
  - "[code://docs/plugins/PLUGINS.md#L804-L876](../../../../docs/plugins/PLUGINS.md#L804-L876) - an engine, as plugin authors read it"
  - plans/plugin/20261031-1200-a-plugin-shows-its-state/plan.md - the plugin view, whose shape, kinds, limits and check a ui takes
  - plans/plugin/53-a-client-sees-plugins-and-connectors/plan.md - the capability types, with `ui` reserved
  - npm://@softov/scena@0.5.18 - `A2uiCreateSurface`: `{ root, components, dataModel }`, with `{ path }` bindings and `{ path, componentId }` lists
---

## Goal

A connector and an agent each show a ui on their page, and both work the same way.
The plugin declares a schema once, as a `ui` capability of its adapter or its engine: A2UI components whose props bind to paths.
For each connector or agent, the plugin then sends the data the schema binds to, and it chooses what that data holds.
A client draws the schema with the data, with no code for that plugin.
The first users are agent-claude and devtunnel.
agent-claude shows plan usage on a `claude-login` connector and on a Claude agent.
devtunnel shows its account on its connector.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `git grep "OperationScope" origin/main -- packages/sdk/src` - the scopes are `list`, `tunnel`, `client`, `changeset` and `resource`; this plan adds none.
- `git grep "quotaSnapshots" origin/main -- packages/sdk/src packages/agent-claude/src` - the plan usage is on main since #243, on the connector health and on a turn's usage.
- `git grep "registerDataProvider\|dataModel" origin/main -- packages` - no data model is sent anywhere today.

### Runtime path

```
plugin registers adapter or engine with a ui capability (schema) -> checkAdapter / registerEngine check it
-> open(record, ui) -> plugin calls ui.show(data) -> channel keeps data by id -> row carries `ui`
-> client reads the schema from x-ahpd-adapters or x-ahpd-engines and the data from the row -> draws both
```

### Gaps

- An engine has no `capabilities`.
- A view prop may not be a `{ path }` binding, and a list may not repeat a template.
- `open` hands an adapter and an engine nothing to send data with.
- A row carries no data for a ui.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The tree is the capability type `ui`, not a new "view" | Softov, 2026-11-02: "I mean ui was the real name..." | 01 |
| A ui is a schema of components bound to a data model | Softov, 2026-11-05: "its a schema ui. based on dataModel." | 01 |
| The schema is declared on the `ui` capability, once for each adapter or engine | Softov, 2026-11-05, chose "Declared on the ui capability" | 01 |
| An engine gets the same `capabilities` list as an adapter; only `ui` is read on an engine now | Softov, 2026-11-05, chose "Engines get capabilities too" | 01 |
| The plugin chooses the data it sends for each record; the host does not join rows | Softov, 2026-11-05: "the agent choose what info to advertise from the connector. same for the tunnel.. A agent X can list info, while agent Y show only a number" | 02 |
| `open` hands the plugin a handle that sends and clears that record's data, and names only that record | Softov, 2026-11-02, chose "A handle from open" | 02 |
| A connector and an agent are built in one plan, the same way | Softov, 2026-11-05: "BOTH must work at the same time and at the same way basically." | 01, 02 |
| The first users are `claude-login` and devtunnel | Softov, 2026-11-05, chose "claude-login and devtunnel" | 03, 04 |
| A Claude agent's ui shows its logins' plan usage | Softov, 2026-11-05, chose "Its logins' plan usage" | 03 |
| A ui's data has the limits of a view: 64 KiB of JSON | (defaulted: the plugin view's limit) | 02 |
| The schema's text is sent as the plugin wrote it, as an adapter's title is today; translation waits for the adapter and engine rows | (defaulted: no adapter or engine row is translated today; see `deferred.md`) | - |
| The plan usage health fields of `claude-login` go; the plan usage travels as the ui's data | (defaulted: one copy of a fact) | 03 |
| Buttons that run an adapter's actions are not in this plan | (defaulted: a second feature; see `deferred.md`) | - |

## Proposed architecture

- **Data flow** - The schema travels with the adapter row on `x-ahpd-adapters` and the engine row on `x-ahpd-engines`. The data travels on the connector row and the agent row, as `ui`.
- **Event flow** - The plugin calls `ui.show(data)` from what it learns, such as a plan answer. The channel sends the changed row to its subscribers.
- **State flow** - The channel keeps each record's data in memory by id, as it keeps health. Closing or removing the record, or unloading its plugin, takes the data away.
- **Layer responsibilities** - The sdk holds the types, the check, the handle and the rows. agent-claude and tunnel-devtunnel hold the schemas and send the data.
- **Source-of-truth files** - [`code://packages/sdk/src/plugins/view.ts`](../../../../packages/sdk/src/plugins/view.ts) for the check, [`code://packages/sdk/src/types/connectors.ts`](../../../../packages/sdk/src/types/connectors.ts) for `Capability`.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - a ui capability with bindings](task-01-a-ui-capability-with-bindings.md) | implemented | - |
| [02 - the rows carry a ui's data](task-02-the-rows-carry-a-uis-data.md) | implemented | 01 |
| [03 - claude shows plan usage](task-03-claude-shows-plan-usage.md) | todo | 02 |
| [04 - devtunnel shows its account](task-04-devtunnel-shows-its-account.md) | todo | 02 |
| [05 - the docs say how a ui is made](task-05-the-docs-say-how-a-ui-is-made.md) | todo | 02 |

## Risks and tradeoffs

- A binding to a path the data does not hold draws nothing. The check cannot see the data, so the docs say this, and each user's tests send full data.
- The plugin view stays literal. Bindings are allowed only in a `ui` capability, so a plugin's own view does not change in this plan.
- Task 03 changes code that the required plan built, which #243 merged. That plan's tests of the connector health change with it.

## Resume state

- **Done so far:** task-01 and task-02 implemented on 2026-11-05.
- **Next action:** [task-03-claude-shows-plan-usage.md](task-03-claude-shows-plan-usage.md).
- **Open questions:** none.
- **Watch out for:** an agent and a connector must stay the same shape. A change to one needs the same change to the other. ahpw draws the ui in a plan of its own.

## Final verification checklist

- [ ] An adapter and an engine with a `ui` capability register, and a bad schema is refused with the rule it broke.
- [ ] `ui.show(data)` puts the data on the connector row and on the agent row, and a subscriber gets the change.
- [ ] Closing, removing or unloading takes the data away.
- [ ] A `claude-login` connector and a Claude agent carry plan usage as `ui`, and the connector health has no plan fields.
- [ ] A devtunnel connector carries its account as `ui`.
- [ ] `pnpm typecheck`, the sdk, agent-claude and tunnel-devtunnel tests, and `pnpm lint` pass.
