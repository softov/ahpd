---
title: A connector and an agent show a view - implemented
date: 2026-11-06
refs:
  - git://aee010bfa
  - "[code://packages/sdk/src/plugins/view.ts](../../../../packages/sdk/src/plugins/view.ts)"
  - "[code://packages/sdk/src/plugins/views.ts](../../../../packages/sdk/src/plugins/views.ts)"
  - "[code://packages/agent-claude/src/views.ts](../../../../packages/agent-claude/src/views.ts)"
  - "[code://packages/tunnel-devtunnel/src/adapter.ts](../../../../packages/tunnel-devtunnel/src/adapter.ts)"
---

A connector and an agent show views as a plugin does, by surface, from a `ViewHandle` that `open` hands the plugin.
A view may carry a data model, and `setViewData` sets one value of it.
A view may draw a `Progress` bar, a `DateTime` and `KeyValue` lines.
A `claude-login` connector shows its account, its plan and a gauge for each usage window.
A devtunnel connector shows its account and its last token refresh.

## What was built

- [`code://packages/sdk/src/plugins/view.ts`](../../../../packages/sdk/src/plugins/view.ts) - the view type, its `dataModel`, bindings by `{ path }`, `Progress`, `DateTime` and `KeyValue`.
- [`code://packages/sdk/src/plugins/views.ts`](../../../../packages/sdk/src/plugins/views.ts) - `ViewHandle` and `setViewData`.
- [`code://packages/sdk/src/resources/recordschannel.ts`](../../../../packages/sdk/src/resources/recordschannel.ts) - a record's views on its channel.
- [`code://packages/agent-claude/src/views.ts`](../../../../packages/agent-claude/src/views.ts) - the `claude-login` view.
- [`code://packages/agent-claude/src/logins.ts`](../../../../packages/agent-claude/src/logins.ts) - the sign-in asks `user:profile` beside `user:inference`.
- [`code://packages/agent-claude/src/usage.ts`](../../../../packages/agent-claude/src/usage.ts) - a login reads its plan usage with one `/usage` query.
- [`code://packages/tunnel-devtunnel/src/adapter.ts`](../../../../packages/tunnel-devtunnel/src/adapter.ts) - the devtunnel view.
- [`code://docs/plugins/PLUGINS.md`](../../../../docs/plugins/PLUGINS.md) - how a plugin, a connector and an agent show a view.

## Verified

- `plugin-view.test.ts`, `plugin-validate.test.ts`, `recordschannel.test.ts` and the agents, connectors, engines and plugins channel tests: the view, its data and its handle.
- `agent-claude-views.test.ts`, `agent-claude-logins.test.ts` and `agent-claude-account.test.ts`: the login view and its usage.
- `tunnel-devtunnel-adapter.test.ts`: the devtunnel view, as key values.
- CI passed every job on PR #249 and PR #251.

## Departures from the plan

- Tasks 07 to 10 were added during the build.
- They add the profile scope, the gauge and the time, the usage read alone, and the devtunnel key values.

## Left for later

- See [deferred.md](deferred.md).
