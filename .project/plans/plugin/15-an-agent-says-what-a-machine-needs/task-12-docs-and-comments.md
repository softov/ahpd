---
title: The docs cover every need and how a plugin declares one, and the comments document
status: todo
depends: [task-06-cofold-declares.md, task-09-every-mount-target-is-checked-at-create.md, task-10-a-path-a-machine-is-made-with-is-absolute-and-there.md]
layer: "docs"
refs:
  - "[code://docs/COMPUTER.md#L171-L224](../../../../docs/COMPUTER.md#L171-L224) - the needs table, which has no cofold row, and the profile rules"
  - "[code://docs/PLUGINS.md#L88-L113](../../../../docs/PLUGINS.md#L88-L113) - what a plugin can register; nothing tells an author about `machine()` or `machineNeeds`"
  - "[code://packages/agent-claude/src/claude.ts#L15-L24](../../../../packages/agent-claude/src/claude.ts#L15-L24) - `claudeExecutablePath`'s comment, which narrates what the docs once pinned"
  - "[code://packages/agent-claude/src/claude.ts#L87-L96](../../../../packages/agent-claude/src/claude.ts#L87-L96) - `computerConfigDir`'s comment, which says nothing here mounts the directory, while `machine()` declares it"
  - "[code://packages/agent-claude/src/claude.ts#L362-L372](../../../../packages/agent-claude/src/claude.ts#L362-L372) - `machine()`'s comment, \"the same host paths the computer docs used to list\""
  - "[code://packages/sdk/src/machine.ts#L1-L15](../../../../packages/sdk/src/machine.ts#L1-L15) - the header, \"Both were silent before this existed\""
  - "[code://packages/computer/src/manifest.ts#L44-L52](../../../../packages/computer/src/manifest.ts#L44-L52) - `Profile.agents`, \"which is what this replaces\""
  - "[code://packages/computer/src/plugin.ts#L132](../../../../packages/computer/src/plugin.ts#L132) - the typo \"a profile disposal\""
  - "[code://packages/computer/src/plugin.ts#L474](../../../../packages/computer/src/plugin.ts#L474) - the typo \"The machine's machine\""
---

## Objective

`docs/COMPUTER.md` lists cofold's needs beside Claude's and says what is refused at create, `docs/PLUGINS.md` tells a plugin author how to declare `machine()` and what the host does with it, and the comments in this plan's code say what each declaration is.

## Files

- `UPDATE: docs/COMPUTER.md:171-224` - a cofold table beside Claude's (`cofoldConfig` to `/ahpd/cofold/cofold/config.json`, `XDG_CONFIG_HOME=/ahpd/cofold`, `computerConfigDir` on `@ahpd/agent-cofold`, from task 06); the profile rules say a relative or missing mount source is refused (task 10).
- `UPDATE: docs/PLUGINS.md` - a short section after "What you can register" on `Agent.machine()`: the four need shapes, how a value is resolved (profile, plugin option, default), that it is read at create and never at load, and that a need value may be a credential and is never printed. The file is hard-wrapped at 80 columns, so the new text is wrapped to match.
- `UPDATE: packages/agent-claude/src/claude.ts:15-24` - the comment says what `claudeExecutablePath` answers and why it follows the link, with no history.
- `UPDATE: packages/agent-claude/src/claude.ts:87-96` - `computerConfigDir` says it is where the configuration needs land inside a machine and what `CLAUDE_CONFIG_DIR` is set to, and that `false` leaves the image's own.
- `UPDATE: packages/agent-claude/src/claude.ts:362-372` - `machine()`'s comment without "used to".
- `UPDATE: packages/sdk/src/machine.ts:1-15` - the header without "Both were silent before this existed" and the 127 story.
- `UPDATE: packages/computer/src/manifest.ts:44-52` - `Profile.agents` without "which is what this replaces" and the 127.
- `UPDATE: packages/computer/src/plugin.ts:132`, `:474` - "a profile disposal" and "The machine's machine" corrected.

## Steps

1. Write the docs in each file's own style: `docs/COMPUTER.md` is one paragraph per line, `docs/PLUGINS.md` is wrapped; do not reflow text around what changes.
2. Remove history from comments; what was, and why, belongs in the decisions.

## Validation

- By reading: every need an agent in this repository declares is in a table; no comment in this plan's files says what used to be.
- No em dashes; `pnpm typecheck` green.

## Resume
