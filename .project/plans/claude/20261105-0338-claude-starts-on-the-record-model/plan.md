---
title: Claude starts on the record's model
domain: claude
status: planned
priority: medium
created: 2026-11-05
revalidated: 2026-11-05
refs:
  - git://ad89aa2d - the commit of ahpd the facts were checked at, after the merges of #240, #241 and #242
  - "[code://packages/agent-claude/src/plugin.ts#L127-L137](../../../../packages/agent-claude/src/plugin.ts#L127-L137) - `open` passes `models` and `modelSources`, and drops the record's `model`"
  - "[code://packages/agent-claude/src/claude.ts#L364-L369](../../../../packages/agent-claude/src/claude.ts#L364-L369) - `defaults`, the mode alone, as VS Code's Claude resolves a session's values"
  - "[code://packages/agent-claude/src/session.ts#L148-L150](../../../../packages/agent-claude/src/session.ts#L148-L150) - a session's stored model is taken only when the agent offers it"
  - "[code://packages/agent-acp/src/agent.ts#L105-L118](../../../../packages/agent-acp/src/agent.ts#L105-L118) - acp's `defaults` puts the record's model in: the pattern to copy"
  - "[code://packages/agent-acp/src/plugin.ts#L382](../../../../packages/agent-acp/src/plugin.ts#L382) - acp's `open` hands the record's model on"
---

## Goal

A Claude agent starts a session on the model its record names, as acp, cofold and pi do.
Today Claude ignores the record's top-level `model`, and a session starts on the CLI's default.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Runtime path

```
record.model -> open -> claude({ model }) -> session start, when settings name no model -> ctx.chosen -> query --model
```

### Gaps

- `open` does not pass `record.model`, and `ClaudeOptions` has no `model`.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Claude reads the record's `model` as the model of a session that names none | Softov, 2026-11-05, chose "Model and host tools" | 01 |
| A record model that the agent does not offer is skipped, and the session starts on the CLI's default | (defaulted: a stored model the agent does not offer is skipped the same way today) | 01 |
| No plugin-wide default model | (defaulted: the chosen option names the record's model only) | 01 |
| The record's model is read at the session's start, and `defaults` stays the mode alone | (defaulted: `defaults` is VS Code's Claude's since #241, and a start that reads the record keeps it so) | 01 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - Claude takes the record's model](task-01-claude-takes-the-record-model.md) | todo | - |

## Resume state

- **Done so far:** nothing.
- **Next action:** task 01.
- **Open questions:** none.
- **Watch out for:** the copy PR edits `packages/agent-claude/package.json`; this plan does not.

## Final verification checklist

- [ ] `pnpm --filter @ahpd/agent-claude test` passes, run alone.
- [ ] `pnpm typecheck` and `pnpm boundary` pass.
