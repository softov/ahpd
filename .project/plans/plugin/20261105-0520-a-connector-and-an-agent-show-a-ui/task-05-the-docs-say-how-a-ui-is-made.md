---
title: The docs say how a ui is made
status: implemented
depends: [task-02-the-rows-carry-a-uis-data.md]
layer: "docs"
refs:
  - "[code://docs/plugins/PLUGINS.md#L580-L642](../../../../docs/plugins/PLUGINS.md#L580-L642) - an adapter and its capabilities"
  - "[code://docs/plugins/PLUGINS.md#L811-L819](../../../../docs/plugins/PLUGINS.md#L811-L819) - an engine"
---

## Objective

A plugin author reads how to give an adapter or an engine a ui: the schema, the bindings, the handle and the limits.

## Files

- `UPDATE: docs/plugins/PLUGINS.md:580-642` - the `ui` capability of an adapter, with a short example.
- `UPDATE: docs/plugins/PLUGINS.md:811-819` - an engine's `capabilities` and its `ui`, the same way.

## Steps

1. Write that a `ui` capability carries a schema.
2. Write that the plugin sends each record's data with the handle from `open`.
3. Give one example: a schema with a Text bound to a path, and the `show` call that fills it.
4. Write the rules: the kinds, `{ path }` props, a list over a path and no `action`.
5. Write the limits: 200 components, and 64 KiB of data.
6. Write that a path the data does not hold draws nothing.
7. Write the same for an engine, and say the two work the same way.

## Validation

- `node <do-spec>/scripts/lint-prose.mjs docs/plugins/PLUGINS.md` reports nothing new.
- The example's schema passes `checkUi`, run in a test or by hand.

## Resume

Done. `PLUGINS.md` has a new section, *The ui a connector or an agent shows*, between *An adapter of your own* and *A tunnel kind of your own*. It says that a `ui` capability carries a `UiSchema`, that a plugin sends each record's data with the handle `open` is handed, and that an adapter's schema is drawn on each connector of it and an engine's on each agent of it. One example declares an `account` capability whose schema is a Column of two `Text`s bound to `account` and `refreshed`, and its `open` calls `ui.show` with that data.

The rules are written beside it: the nine kinds; props as literals or `{ path }`; `children` as a list of ids or `{ path, componentId }` with each row's paths relative; no `action`; the data as a JSON object the plugin chooses for that one record, with `show` and `clear`; closing, removing or unloading takes the data away, and a stale handle writes nothing; 200 components and 64 KiB of data; and a path the data does not hold draws nothing, which the check cannot see.

The adapter's capability list now names `ui` as a type, with a bullet that its schema is checked at registration by a view's rules, and `open` is written `open(connector, ui)` with the handle described. The engine section's example gains a `ui` capability and `open(record, ui)`, and a new bullet says `capabilities` works as an adapter's, with `ui` the one type the host reads there and a link to the section.

Verified: `node <do-spec>/scripts/lint-prose.mjs docs/plugins/PLUGINS.md` ran and reported no finding on any line this task wrote; the long-sentence findings it reports elsewhere were there before. The example's schema was checked by hand against `checkUi`'s rules: `root` names a component, every id matches its key, each kind is one of the nine, each `Text.text` is a one-member `{ path }`, the Column's `children` names existing components, there is no `action`, one parent each and no cycle, and it is far under 200 components and 64 KiB. `pnpm exec tsc -p tsconfig.json --noEmit` printed nothing, `pnpm boundary` reported every package with none undeclared, and `pnpm -s test:unit --maxWorkers=6` passed 483 files with 8109 tests and 31 skipped.

Found: the docs' other `open(connector)` example, the webhook one under *An adapter of your own*, declares no `ui` capability and still takes one argument, so it is left as it is. An adapter or an engine gets a handle whether or not it declares a `ui` capability, and the docs say so.

Left: nothing this task asked for. An ahpw client that draws a ui is a plan of its own.