---
title: A subagent has its own chat, linked from the call that started it
domain: claude
status: planned
priority: medium
created: 2026-09-26
revalidated: 2026-09-26
requires:
  - plans/claude/03-an-empty-round-is-announced/plan.md
changes: []
creates: []
decisions:
  - decisions/a-backend-opens-a-subagent-chat-through-the-host.md
  - decisions/subagent-chats-are-restored-from-the-cli-meta-file.md
refs:
  - "[code://packages/agent-claude/src/session.ts#L2187](../../../../packages/agent-claude/src/session.ts#L2187) - where every `stream_event` is handled, with `parent_tool_use_id` read only for round state"
  - "[code://packages/agent-claude/src/session.ts#L818](../../../../packages/agent-claude/src/session.ts#L818) - `rounds`, already kept per `parent_tool_use_id`"
  - "[code://packages/agent-claude/src/session.ts#L1670](../../../../packages/agent-claude/src/session.ts#L1670) - the SDK options, `includePartialMessages` on and `forwardSubagentText` absent"
  - "[code://packages/agent-claude/src/session.ts#L1478](../../../../packages/agent-claude/src/session.ts#L1478) - `canUseTool`, whose options carry `agentID` for a tool inside a subagent"
  - "[code://packages/agent-claude/src/session.ts#L2156-L2185](../../../../packages/agent-claude/src/session.ts#L2156-L2185) - `task_progress`, the one subagent system message handled today"
  - "[code://packages/agent-claude/src/session.ts#L133](../../../../packages/agent-claude/src/session.ts#L133) - `Task` and `Agent`, already recognised as the spawning tools"
  - "[code://packages/agent-claude/src/claude.ts#L382](../../../../packages/agent-claude/src/claude.ts#L382) - `stateFile`, which reads the CLI's transcript files directly"
  - "[code://packages/sdk/src/types/agent.ts#L93](../../../../packages/sdk/src/types/agent.ts#L93) - `Start`, where the seam goes"
  - "[code://packages/sdk/src/host.ts#L1142-L1165](../../../../packages/sdk/src/host.ts#L1142-L1165) - `chatUriFor` and `sessionOfChat`, which parse only the `default` chat authority"
  - "[code://packages/sdk/src/host.ts#L774-L784](../../../../packages/sdk/src/host.ts#L774-L784) - `chatSummary`, always `interactivity: 'full'` today"
  - "[code://packages/sdk/src/host.ts#L6350](../../../../packages/sdk/src/host.ts#L6350) - `session/chatAdded` for a second chat, the pattern to follow"
  - https://github.com/microsoft/vscode/blob/832cf23c588/src/vs/platform/agentHost/node/claude/phase12-plan.md - the reference's Claude subagent plan, with what it verified about the SDK
  - https://github.com/microsoft/vscode/blob/832cf23c588/src/vs/platform/agentHost/node/claude/claudeSubagentSignals.ts - tagging a subagent's signals and announcing it on first sight
  - https://github.com/microsoft/vscode/blob/832cf23c588/src/vs/platform/agentHost/node/agentSideEffects.ts#L1002-L1080 - opening the chat, seeding its turn and linking it from the spawning call
  - https://github.com/microsoft/vscode/blob/832cf23c588/src/vs/platform/agentHost/common/state/sessionState.ts#L1196-L1200 - `buildSubagentChatUri`
  - npm://@microsoft/agent-host-protocol@0.9.0 - `ChatOrigin` kind `tool`, `ToolResultSubagentContent`, `ChatInteractivity.ReadOnly`
---

## Goal

A subagent Claude starts is drawn as its own read-only chat, opened from the `Task` call that started it, instead of its tool calls appearing inline in the main turn.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `grep -n "parent_tool_use_id" sdk.d.ts` (0.3.278) - set on assistant, user and stream-event messages from inside a subagent; `forwardSubagentText` forwards a subagent's text and thinking, and without it only its tool calls arrive.
- `grep -n "agentID" sdk.d.ts` - `canUseTool` is told the subagent's id for a tool inside one.
- `ls ~/.claude/projects/*/<session>/subagents/` - `agent-<id>.jsonl` and `agent-<id>.meta.json`, the meta holding `agentType`, `description`, `toolUseId` and `spawnDepth`.
- The protocol at 0.9.0 has `ChatOrigin` `{ kind: 'tool', chat, toolCallId }`, `ToolResultSubagentContent` `{ type: 'subagent', resource, title, agentName?, description? }` and `ChatInteractivity.ReadOnly`, and says a host must keep the origin and the content consistent.
- The reference opens a subagent chat `read-only`, with a `tool` origin, and sets `forwardSubagentText: true`.

### Runtime path

```
main turn: tool_use Task { subagent_type, description, prompt }  -> tool call in the main chat
frame with parent_tool_use_id = that call, first time               -> [new] start.subagent(call, info)
  host: ahp-chat://subagent/<session>/<call>, session/chatAdded (origin tool, read-only),
        chat/turnStarted with the prompt, toolCallContentChanged + subagent content on the call
frames with that parent_tool_use_id                                  -> [new] emitted on the subagent chat
tool_result for the call (foreground) or task_notification (background) -> [new] the subagent turn completes
```

### Gaps

- Subagent tool calls land in the main turn today, and its text never arrives because `forwardSubagentText` is off.
- The host parses only the `default` chat authority, marks every chat `full`, and has no way for a backend to open a chat.
- A permission ask from inside a subagent is drawn on the main chat.
- Nothing rebuilds a subagent's chat after a restart.

## Decisions locked in

| Decision | Task |
| --- | --- |
| [A backend opens a subagent chat through the host](../../../decisions/a-backend-opens-a-subagent-chat-through-the-host.md) | 02, 03 |
| [A subagent chat is restored from the CLI's own meta file](../../../decisions/subagent-chats-are-restored-from-the-cli-meta-file.md) | 06 |

| What | Source | Task |
| --- | --- | --- |
| `forwardSubagentText: true` | the reference's `claudeSdkOptions.ts:185`; without it a live subagent chat has tool calls only | 03 |
| The chat URI is `ahp-chat://subagent/<base64url session>/<tool call id>` | the reference's `buildSubagentChatUri`; VS Code's `isSubagentChatUri` reads the `subagent` authority | 02 |
| The chat is `read-only`, with origin `{ kind: 'tool', chat, toolCallId }`, and the call carries the matching `subagent` content | the protocol, which requires the two to agree; the reference | 02 |
| `Task` and `Agent` both spawn; title and agent name from `subagent_type`, description from `description`, the opening message from `prompt`; `Subagent` when the call was never seen | the reference's phase 12 Q1 and Q8 | 03 |
| A nested subagent's link goes on the chat of the subagent that spawned it | the reference's `spawningToolParentId` | 03 |
| Foreground ends on the call's `tool_result`; a call named by `task_started` is background and ends on a terminal `task_notification` | the reference's phase 12 Q3 and Q17 | 04 |
| A permission ask from inside a subagent is drawn on its chat, through `canUseTool`'s `agentID` | the reference's phase 12 Q13 | 05 |
| An empty round inside a subagent is announced on its chat, closing what `claude/03` left out | `claude/03` task 02, review fix | 03 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A subagent seen on a real stream](task-01-a-subagent-on-a-real-stream.md) | todo | - |
| [02 - The host opens a subagent chat for a backend](task-02-the-host-opens-a-subagent-chat.md) | todo | - |
| [03 - Claude's subagent frames go to that chat](task-03-subagent-frames-go-to-their-chat.md) | todo | 01, 02 |
| [04 - A subagent's turn ends, foreground or background](task-04-a-subagent-turn-ends.md) | todo | 03 |
| [05 - A permission ask inside a subagent is asked there](task-05-asks-inside-a-subagent.md) | todo | 03 |
| [06 - A subagent's chat is there again after a restart](task-06-restored-after-a-restart.md) | todo | 03 |
| [07 - Docs and upstream](task-07-docs-and-upstream.md) | todo | 04, 05, 06 |

## Risks and tradeoffs

- The meta file is the CLI's, undocumented; task 06 falls back to the `agentId:` suffix when it is missing.
- `forwardSubagentText` makes a busy subagent as chatty on the wire as the main turn.
- A background subagent whose `task_notification` has no `tool_use_id` never ends; the reference lists the same limit.
- ahpc and ahpapp need to draw a `subagent` content and a read-only chat; VS Code already does.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-a-subagent-on-a-real-stream.md](task-01-a-subagent-on-a-real-stream.md), and task 02 in parallel.
- **Open questions:** none.
- **Watch out for:** a subagent frame may arrive before the main stream has shown the `Task` call's input, when a resume starts mid-call; fall back to `Subagent` rather than wait.

## Final verification checklist

- [ ] A captured stream with a subagent, checked into `test/fixtures`.
- [ ] VS Code: a turn that uses `Task` shows the subagent as its own chat, opened from the call, with its text, thinking and tool calls.
- [ ] VS Code: a permission ask inside the subagent appears in its chat.
- [ ] After a daemon restart the subagent chat is still there.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm boundary` green; the new actions validate against the protocol schema.
- [ ] `UPSTREAM.md`, `docs/`, `plans/index.md` updated.
