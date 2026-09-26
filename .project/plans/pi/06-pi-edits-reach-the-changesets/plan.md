---
title: pi's edits reach the host's changesets
domain: pi
status: planned
priority: medium
created: 2026-09-26
revalidated: 2026-09-26
requires: []
changes: []
creates: []
decisions: []
refs:
  - "[code://packages/sdk/src/types/agent.ts#L196-L203](../../../../packages/sdk/src/types/agent.ts#L196-L203) - `Start.onFileEdit(turnId, path, 'before' | 'after')`"
  - "[code://packages/agent-pi/src/mapping.ts#L129-L185](../../../../packages/agent-pi/src/mapping.ts#L129-L185) - `tool_execution_start` has the arguments, `tool_execution_end` only the id and result"
  - "[code://packages/agent-claude/src/session.ts#L1080-L1085](../../../../packages/agent-claude/src/session.ts#L1080-L1085) - the sibling names the editing tools rather than guessing from input"
  - "[code://packages/agent-claude/src/session.ts#L1516-L1528](../../../../packages/agent-claude/src/session.ts#L1516-L1528) - `before`, keyed by the call id"
  - "[code://packages/agent-claude/src/session.ts#L1648-L1653](../../../../packages/agent-claude/src/session.ts#L1648-L1653) - `after`, paired by the same id"
  - "[code://packages/agent-cofold/src/session.ts#L237-L275](../../../../packages/agent-cofold/src/session.ts#L237-L275) - the other sibling's `editing` map and `settleEdit`, which also owes an `after` for a call that never finished"
  - npm://@earendil-works/pi-coding-agent@^0.87.1 - the `edit` and `write` tools take `path`, in `dist/core/tools/edit.d.ts` and `write.d.ts`
  - npm://@earendil-works/pi-agent-core@0.87.1 - the `tool_execution_start` and `tool_execution_end` event shapes, in `dist/types.d.ts`
---

## Goal

A file pi's `edit` or `write` tool changes shows in the host's changeset for the turn, as it does for the other backends.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "onFileEdit" packages/agent-pi` - nothing.
- `grep -n "path" dist/core/tools/edit.d.ts dist/core/tools/write.d.ts` in pi 0.87.1 - both take `path`, which may be relative to the session's directory.

### Runtime path

```
pi tool_execution_start (edit | write, args.path) -> [new] editing.set(toolCallId, absolute path) -> onFileEdit(turnId, path, 'before')
pi tool_execution_end (toolCallId) -> [new] onFileEdit(turnId, path, 'after')
agent_settled with calls still open -> [new] 'after' for each
```

### Gaps

- `start.onFileEdit` is never called, so a pi session's changeset is always empty.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| Call `Start.onFileEdit` around pi's `edit` and `write` tools on `tool_execution_start` and `tool_execution_end` | Softov, 2026-09-26: "Call `Start.onFileEdit` around pi's `edit` and `write` tools on `tool_execution_start` and `tool_execution_end`" | 01 |
| Named tools only; `bash` is not guessed at | [`code://packages/agent-claude/src/session.ts#L1074-L1079`](../../../../packages/agent-claude/src/session.ts#L1074-L1079) | 01 |
| A relative `path` is resolved against the session's working directory | the host names files by absolute path; pi's tools resolve against `cwd` | 01 |
| A call still open when the turn settles gets its `after` then | [`code://packages/agent-cofold/src/session.ts#L262-L275`](../../../../packages/agent-cofold/src/session.ts#L262-L275) | 01 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - An edit is announced before and after](task-01-an-edit-is-announced-before-and-after.md) | todo | - |

## Risks and tradeoffs

- `tool_execution_start` is raised as the tool begins, so the `before` read races the tool's own write, as the sibling's does; best effort, as its comment says.
- A tool a pi extension adds that writes files is not seen; only pi's two built-in names are.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-an-edit-is-announced-before-and-after.md](task-01-an-edit-is-announced-before-and-after.md).
- **Open questions:** none.
- **Watch out for:** the session is where `onFileEdit` is called, not `mapping.ts`, which only returns actions.

## Final verification checklist

- [ ] An `edit` call produces one `before` and one `after` for its absolute path on the right turn.
- [ ] `pnpm test`, `pnpm typecheck` green.
- [ ] `plans/index.md` updated.
