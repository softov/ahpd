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

Done. `PLUGINS.md` has a new section, *The ui a connector or an agent shows*.
It is between *An adapter of your own* and *A tunnel kind of your own*.
It says that a `ui` capability carries a `UiSchema`, and that a plugin sends the data of each record with the handle of `open`.
An adapter's schema is drawn on each of its connectors, and an engine's schema on each of its agents.
One example declares an `account` capability, with a Column of two `Text`s bound to `account` and `refreshed`.
Its `open` calls `ui.show` with that data.

The section gives these rules:

- The nine kinds.
- A prop is a literal or `{ path }`.
- `children` is a list of ids or `{ path, componentId }`, and the paths of each row are relative.
- No `action`.
- The data is a JSON object that the plugin chooses for that one record, with `show` and `clear`.
- A close, a removal or an unload removes the data, and a stale handle writes nothing.
- 200 components and 64 KiB of data.
- A path that the data does not hold draws nothing, and the check cannot see it.

The adapter's capability list names `ui` as a type now, and a bullet says that the schema is checked at registration by a view's rules.
`open` is written `open(connector, ui)`, and the handle is described.
The engine section's example has a `ui` capability and `open(record, ui)`.
A new bullet says that `capabilities` works as an adapter's, and links to the section.
It says that `ui` is the one type the host reads there.

Verified: `lint-prose.mjs` on `docs/plugins/PLUGINS.md` reported no finding on a line that this task wrote.
The long-sentence findings that it reports on other lines were there before.
The example's schema was checked by hand against the rules of `checkUi`, and it is far under 200 components and 64 KiB.
`pnpm exec tsc -p tsconfig.json --noEmit` printed nothing, and `pnpm boundary` reported no undeclared package.
`pnpm -s test:unit --maxWorkers=6` passed 483 files: 8109 tests and 31 skipped.

Found: the other `open(connector)` example of the docs, the webhook one under *An adapter of your own*, declares no `ui` capability.
It still takes one argument, so it stays as it is.
An adapter or an engine gets a handle whether or not it declares a `ui` capability, and the docs say so.
