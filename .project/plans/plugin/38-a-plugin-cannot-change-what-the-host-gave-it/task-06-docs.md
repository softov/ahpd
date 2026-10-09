---
title: The plugin docs say what a plugin gets is read-only
status: done
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

Implemented 2026-10-08. One subsection, "Everything you are handed is read-only", at the end of "The contract" in `docs/PLUGINS.md` - after naming a secret, before "What you can register" - because that is where a plugin author is told what `apply` is handed and what registering means. Three short paragraphs: every value the host gives a plugin is a copy, and the ones that are frozen (the context and its `paths`, a `Start`, a host tool's turns, a listener's event, a `secretAtUse` node) throw on a write; registration ends when `apply` returns, with the loader's own sentence quoted, and a late `on` never fires; and none of it is a sandbox, because a plugin is trusted code in the daemon's process, so naming one is the trust decision.

The prose is wrapped as the rest of the file is, and the codebase's own wording was kept - the loader's sentence is quoted exactly as `packages/sdk/src/plugins.ts` throws it. One point beyond the task's wording, kept because the documents would otherwise overstate the promise: the options object handed to `apply` is the plugin's own fresh copy rather than a frozen one (only a `secretAtUse` node inside it is frozen), so the section says a write there changes nothing the daemon holds rather than that it throws.

Validated: there is no prose linter in this repository - `tools/` holds `schema.mjs`, `validate.mjs` and the test-case runner, and `scripts/boundary.mjs` checks package imports alone - so the file was read back against the rule that matters here, no em dashes and no rewrapping of text that was already there.
