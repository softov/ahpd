---
title: The docs and the package README say what the code does
status: todo
depends: [task-07-ahpd-inside-follows-symlinks.md, task-08-ahpd-takes-the-cofold-releases.md, task-12-search-providers-in-configured-order.md, task-13-no-model-says-what-to-add.md]
layer: "docs"
refs:
  - "[code://docs/PLUGINS.md#L407-L447](../../../../docs/PLUGINS.md#L407-L447) - the section on the tools a session runs, hard-wrapped"
  - "[code://packages/agent-cofold/src/capabilities.ts#L63-L70](../../../../packages/agent-cofold/src/capabilities.ts#L63-L70) - `searchProviders`, a fixed order under a comment that says otherwise"
  - "[code://packages/agent-cofold/package.json#L44-L48](../../../../packages/agent-cofold/package.json#L44-L48) - `files` lists a `README.md` that does not exist"
  - "[code://packages/agent-pi/README.md](../../../../packages/agent-pi/README.md) - the layout a backend's README follows"
---

## Objective

`docs/PLUGINS.md` and a new `packages/agent-cofold/README.md` say which tools a cofold session has, what confines them, and in which order search providers are tried, as the code does it.

## Files

- `UPDATE: docs/PLUGINS.md:407-447` - the section, rewritten.
- `UPDATE: packages/agent-cofold/src/capabilities.ts:63` - the `searchProviders` comment.
- `CREATE: packages/agent-cofold/README.md` - the package's README.

## Steps

1. Search order: after task 12, providers are tried in the order the configuration lists them; the comment at `capabilities.ts:63` and the sentence at `PLUGINS.md:439` say so, per [decision: configured order](../../../decisions/search-providers-are-tried-in-configured-order.md).
2. Rewrite only the section at `PLUGINS.md:407-447` with one paragraph per line and no hard wrap; the rest of the file stays as it is.
3. The section says: the permission mode is what confines the tools, not the workspace; `default` asks before a write, a command, a web fetch and a read outside the workspace; the workspace check follows symlinks; `web_fetch` refuses internal addresses; memory is per workspace and shared by its sessions; a session with no working directory works in the daemon's current directory; a shell call shows its bare command; a turn with no model configured fails and says to add `"model"` to the cofold configuration file.
4. Write `packages/agent-cofold/README.md` after `packages/agent-pi/README.md`: what the backend is, how to load it, the options table (with `tools`), the tools a session runs, and a link to `docs/PLUGINS.md` for the rest; one sentence per line, no em dash, no hard wrap.

## Validation

- The search-order sentence in `docs/PLUGINS.md` and the comment on `searchProviders` both say the configured order.
- No line in the rewritten section or the README is a wrapped fragment of a paragraph, and neither holds an em dash.
- `pnpm boundary` green, and `npm pack --dry-run` in `packages/agent-cofold` lists `README.md`.

## Resume
