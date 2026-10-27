---
title: A stopped call stays stopped
domain: claude
status: built
priority: high
created: 2026-10-27
revalidated: 2026-10-27
requires:
  - plans/claude/07-a-turn-ends-with-no-call-left-open/plan.md
refs:
  - "[code://packages/agent-claude/src/session/stream.ts#L480-L628](../../../../packages/agent-claude/src/session/stream.ts#L480-L628) - `results`, which completes the call it finds and names the turn that runs when the result arrives"
  - "[code://packages/agent-claude/src/session/stream.ts#L599-L605](../../../../packages/agent-claude/src/session/stream.ts#L599-L605) - the after side of an edit, recorded against the turn that runs when the result arrives"
  - "[code://packages/agent-claude/src/session/turns.ts#L624-L684](../../../../packages/agent-claude/src/session/turns.ts#L624-L684) - `cancel`, which puts the turn in the history and keeps its open parts"
  - "[code://packages/agent-claude/src/session/workers.ts#L615-L650](../../../../packages/agent-claude/src/session/workers.ts#L615-L650) - `settleOpen`, which ends the open calls of a turn as the protocol's reducer ends them"
  - "[code://packages/agent-claude/src/session/turns.ts#L380](../../../../packages/agent-claude/src/session/turns.ts#L380) - the result of a `!` command, which changes nothing when its turn is no longer active"
  - "[code://packages/sdk/src/host/snapshots.ts#L326](../../../../packages/sdk/src/host/snapshots.ts#L326) - the snapshot of a chat, which is the record of the backend"
  - npm://@microsoft/agent-host-protocol@1.0.0 - `updateToolCallInParts` in the chat reducer, which completes a call in the active turn and in no other, and `ToolCallActionBase.turnId`, which is required
  - https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/claude/claudeToolCallRegistry.ts#L48-L52 - the reference host attributes each result to the turn its call was made in
  - https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/claude/claudeMapSessionEvents.ts#L360-L423 - the reference host completes a call on the turn that made it, and its own reducer then drops a completion for an ended turn
---

## Goal

A person stops a Claude turn while a tool call runs.
The CLI then writes a result for that call, after the turn has ended.
The session applies the result to the ended turn, and it announces a completion that names no turn.
So a client that watched keeps the call cancelled, and a client that subscribes later reads it completed.
With this plan, a result for a call whose turn has ended changes neither the record nor any client.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- A test stops a turn while a Bash call runs, and then gives the session the result that the CLI writes for the call.
- The session sends `chat/toolCallComplete` with no `turnId`, and its snapshot says `completed` where the replayed actions say `cancelled`.
- The session also says `Thinking` again after the stop.
- Claude Code transcripts hold the frame: a `tool_result` with `is_error: true` after the stop, then the text `[Request interrupted by user for tool use]`.
- `rg -n "onFileEdit" packages/agent-claude/src` - the after side of an edit names the turn that runs when the result arrives, so a stopped edit names no turn.

### Runtime path

```
cancel -> the turn goes into the history, its parts stay open
  -> tool_result -> results finds the part -> the record says completed
  -> chat/toolCallComplete with no turnId -> every client drops it
```

### Gaps

- A result completes the call it finds, whatever turn is running.
- The completion names the running turn, not the turn of the call.
- The after side of an edit names the running turn.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A result changes the record, and is announced, only while the turn of its call is the active turn. | The chat reducer's `updateToolCallInParts` in npm://@microsoft/agent-host-protocol@1.0.0, and the rule of the `!` command at [code://packages/agent-claude/src/session/turns.ts#L380](../../../../packages/agent-claude/src/session/turns.ts#L380) | 01 |
| A result for a call in an ended turn still releases what the call holds: its wait for a sign-in, its row line, its answered input and its worker record. | The same releases on the path of a live result, [code://packages/agent-claude/src/session/stream.ts#L520-L626](../../../../packages/agent-claude/src/session/stream.ts#L520-L626) | 01 |
| The after side of an edit is recorded against the turn of its before side. | The reference host attributes each result to the turn its call was made in, https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/claude/claudeToolCallRegistry.ts#L48-L52 | 01 |
| No `chat/toolCallComplete` is sent for a call in an ended turn. | (defaulted: the reducer of every client drops it, so the action changes nothing) | 01 |

## Proposed architecture

- **Data flow** - a result completes a call in the active turn, and only releases a call in an ended turn.
- **Event flow** - no action for a call in an ended turn.
- **State flow** - an ended turn keeps its calls as `settleOpen` left them.
- **Layer responsibilities** - `@ahpd/agent-claude`: the stream finds whether the turn of a call is still active.
- **Source-of-truth files** - [`code://packages/agent-claude/src/session/stream.ts`](../../../../packages/agent-claude/src/session/stream.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A late result changes nothing](task-01-a-late-result-changes-nothing.md) | done | - |

## Risks and tradeoffs

- A tool that finished its work after the stop shows as cancelled - no action of the protocol changes an ended turn.
  The changeset still records the after side of an edit.

## Resume state

- **Done so far:** planned and built 2026-10-27; see [implemented.md](implemented.md).
- **Next action:** none.
- **Open questions:** none.
- **Watch out for:** a test must give the result after `cancel`, or the call is still in the active turn and the old code passes.

## Final verification checklist

- [x] The new cases fail on the session before this change.
- [x] `pnpm boundary`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.
- [x] `plans/index.md` updated.
