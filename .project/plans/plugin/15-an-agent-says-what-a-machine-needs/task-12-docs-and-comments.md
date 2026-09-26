---
title: The docs cover every need and how a plugin declares one, and the comments document
status: todo
depends: [task-06-cofold-declares.md, task-09-every-mount-target-is-checked-at-create.md]
layer: "docs"
refs:
  - "[code://docs/COMPUTER.md](../../../../docs/COMPUTER.md) - the needs table, which has no cofold row"
  - "[code://docs/PLUGINS.md](../../../../docs/PLUGINS.md) - nothing tells a plugin author about `machine()` or `machineNeeds`"
  - "[code://packages/agent-claude/src/claude.ts#L18](../../../../packages/agent-claude/src/claude.ts#L18) - a comment that narrates what the docs once pinned"
  - "[code://packages/sdk/src/machine.ts](../../../../packages/sdk/src/machine.ts) - the header \"Both were silent before this existed\""
---

## Objective

`docs/COMPUTER.md` lists cofold's need beside Claude's, `docs/PLUGINS.md` tells a plugin author how to declare `machine()` and what the host does with it, and the comments in this plan's code say what each declaration is.

## Files

- `UPDATE: docs/COMPUTER.md` - a cofold row in the needs table (fixed target and `XDG_CONFIG_HOME`, from task 06).
- `UPDATE: docs/PLUGINS.md` - a short section on `Agent.machine()`, the three delivery kinds and how a value is resolved.
- `UPDATE: packages/agent-claude/src/claude.ts:18`, `packages/sdk/src/machine.ts` (header), `packages/computer/src/manifest.ts` (`Profile.agents`, "which is what this replaces") - comments rewritten to document; the typos "The machine's machine" and "a profile disposal" fixed.

## Steps

1. Write the docs in the file's own style; do not reflow text around what changes.
2. Remove history from comments; what was, and why, belongs in the decisions.

## Validation

- By reading: every need an agent in this repository declares is in the table; no comment in this plan's files says what used to be.
- No em dashes; `pnpm typecheck` green.

## Resume
