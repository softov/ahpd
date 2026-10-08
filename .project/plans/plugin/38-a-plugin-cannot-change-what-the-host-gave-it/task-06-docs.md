---
title: The plugin docs say what a plugin gets is read-only
status: todo
depends: [task-02-an-agents-start-holds-copies.md, task-03-the-host-holds-copies-of-contributions.md, task-04-events-paths-and-options-are-per-plugin-copies.md]
layer: "docs"
refs:
  - "[code://docs/PLUGINS.md](../../../../docs/PLUGINS.md) - the plugin author's guide"
---

## Objective

`docs/PLUGINS.md` says every value a plugin gets is a frozen copy, that registration ends when `apply` returns, and that a plugin is trusted code.

## Files

- `UPDATE: docs/PLUGINS.md` - one short section.

## Steps

1. Write the section, short and direct.

## Validation

- `node tools/lint-prose.mjs` or the repo's prose check passes, if it has one.

## Resume
