---
title: The docs say how a ui is made
status: dropped
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

