---
title: The docs say how a view is made
status: done
depends: [task-03-a-data-event-sets-a-value.md]
layer: "docs"
refs:
  - "[code://docs/plugins/PLUGINS.md#L1011-L1032](../../../../docs/plugins/PLUGINS.md#L1011-L1032) - the plugin view"
  - "[code://docs/plugins/PLUGINS.md#L572-L700](../../../../docs/plugins/PLUGINS.md#L572-L700) - an adapter and its capabilities"
  - "[code://docs/plugins/PLUGINS.md#L804-L876](../../../../docs/plugins/PLUGINS.md#L804-L876) - an engine"
  - "[code://docs/plugins/PLUGINS.md#L1575-L1830](../../../../docs/plugins/PLUGINS.md#L1575-L1830) - the `x-ahpd-plugins`, `x-ahpd-connectors` and `x-ahpd-agents` channels"
---

## Objective

`PLUGINS.md` says that a plugin, a connector and an agent show a view the same way.
It names the three calls, the data model, the `view` capability and the `viewData` action.

## Files

- `UPDATE: docs/plugins/PLUGINS.md:1011-1032` - the view section covers a plugin's page, a connector and an agent, the data model and `setViewData`.
- `UPDATE: docs/plugins/PLUGINS.md:572-700` - the `view` capability, and `open(connector, view)`.
- `UPDATE: docs/plugins/PLUGINS.md:804-876` - the `view` capability on an engine, and `open(record, view)`.
- `UPDATE: docs/plugins/PLUGINS.md:1575-1830` - each of the three channels names `views` on its row and the `viewData` action.

## Steps

1. Remove the section on a `ui` that #248 added.
2. Write the view section for a plugin's page, a connector and an agent, with the three calls.
3. Write that a prop may bind to `{ path }` in the data model, and that a missing path draws nothing.
4. Give one example: an adapter with a `view` capability, and an `open` that calls `showView` and `setViewData`.
5. Write the `view` capability in the adapter and engine sections.
6. Write `views` and `<scheme>/viewData` in the three channel sections.

## Validation

- `rg -n "UiSchema|UiHandle|ui\.show|checkUi" docs/` finds nothing.
- Check the example by hand against the rules of `checkView`.
- `node <do-spec>/scripts/lint-prose.mjs docs/plugins/PLUGINS.md` reports no finding on a line that this task wrote.

## Resume

Done. *The view a connector or an agent shows* replaces the section on a `ui`.
The plugin view section has the data model, the bindings and `setViewData`.
The adapter and engine sections name the `view` capability and `open(connector, view)`.
The `x-ahpd-plugins`, `x-ahpd-connectors` and `x-ahpd-agents` sections name `views` and the `viewData` action.

Verified: a search of `docs/` finds no `ui` name of #248.
`lint-prose.mjs` reports no finding on a line that this task wrote.
