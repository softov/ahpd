---
title: Tool calls say what happened, and an agent's edits reach review
domain: acp
status: built
priority: medium
created: 2026-09-26
revalidated: 2026-09-26
requires: []
changes: []
creates: []
decisions:
  - decisions/acp-ports-come-through-start.md
refs:
  - "[code://packages/agent-acp/src/mapping.ts#L122-L186](../../../../packages/agent-acp/src/mapping.ts#L122-L186) - `tool_call` and `tool_call_update`: ready on `rawInput`, text content only"
  - "[code://packages/agent-acp/src/mapping.ts#L63-L71](../../../../packages/agent-acp/src/mapping.ts#L63-L71) - how terminal content could be built"
  - "[code://packages/agent-acp/src/session.ts#L804-L818](../../../../packages/agent-acp/src/session.ts#L804-L818) - `runCommand`, which already builds AHP terminal content"
  - "[code://packages/agent-acp/src/session.ts#L311-L316](../../../../packages/agent-acp/src/session.ts#L311-L316) - `fs/write_text_file`, which bypasses `onFileEdit`"
  - "[code://packages/sdk/src/types/agent.ts#L203](../../../../packages/sdk/src/types/agent.ts#L203) - `Start.onFileEdit`, how an edit reaches the host's changesets"
  - npm://@microsoft/agent-host-protocol@0.9.0 - `chat/toolCallReady`, tool result content
---

## Goal

A tool call is ready only when the agent has moved it out of `pending`, so a permission request that follows is not contradicted; a call that arrives already finished is finished; a late `rawInput` readies it.
A call's terminal content shows the host terminal, its diff content becomes a changeset entry, and every file the agent writes through the bridge reaches the host's review.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Gaps

- `chat/toolCallReady` with `not-needed` is sent on `rawInput`, before a permission request may arrive.
- A call that arrives `completed` stays open; `diff`, `terminal`, `locations`, `kind` and `rawOutput` are dropped.
- `fs/write_text_file` does not call `onFileEdit`.

## Decisions locked in

| Decision | Task |
| --- | --- |
| [An ACP backend reaches files and a shell through Start](../../../decisions/acp-ports-come-through-start.md) | 03 |

| What | Source | Task |
| --- | --- | --- |
| Ready with `not-needed` only when the status leaves `pending` | the research of 2026-09-26 | 01 |

## Proposed architecture

- **Layer responsibilities** - `mapping.ts`: when a call moves and what its content is · `session.ts`: `onFileEdit` around a write.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A call moves when the agent moves it](task-01-a-call-moves-when-the-agent-moves-it.md) | done | - |
| [02 - Terminal and diff content are kept](task-02-terminal-and-diff-content.md) | done | - |
| [03 - An agent's write reaches review](task-03-an-agent-write-reaches-review.md) | done | - |
| [04 - Docs](task-04-docs.md) | done | 01, 02, 03 |

## Risks and tradeoffs

- A client that already drew `not-needed` from the old timing sees ready later - no client relies on it early.

## Resume state

- **Done so far:** built 2026-10-02, see [implemented.md](implemented.md).

## Final verification checklist

- [x] A permission request is never preceded by `not-needed`.
- [x] An agent's edit is in the changeset.
- [x] `pnpm test`, `pnpm typecheck` green.
- [x] `plans/index.md` updated.
