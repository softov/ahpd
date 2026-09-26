---
title: A subagent has its own chat, linked from the call that started it
domain: claude
status: active
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
  - decisions/a-spawning-call-carries-the-reference-subagent-meta.md
  - decisions/a-background-worker-is-linked-when-its-call-completes.md
  - decisions/a-cancelled-turn-ends-only-its-own-workers.md
  - decisions/background-is-any-task-started-but-foreground-ends-on-its-result.md
  - decisions/a-worker-whose-spawning-call-was-compacted-is-listed.md
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
| [A subagent chat is restored from the CLI's own meta file](../../../decisions/subagent-chats-are-restored-from-the-cli-meta-file.md) | 06, 12, 13 |
| [A spawning call carries the reference's subagent _meta, under its names](../../../decisions/a-spawning-call-carries-the-reference-subagent-meta.md) | 10 |
| [A background worker is linked from its call when the call completes](../../../decisions/a-background-worker-is-linked-when-its-call-completes.md) | 09, 10 |
| [A cancelled turn ends only the workers it spawned](../../../decisions/a-cancelled-turn-ends-only-its-own-workers.md) | 11 |
| [Any task_started marks a worker background, but a foreground spawn still ends on its tool_result](../../../decisions/background-is-any-task-started-but-foreground-ends-on-its-result.md) | 14 |
| [A restored worker whose spawning call was compacted out is listed anyway](../../../decisions/a-worker-whose-spawning-call-was-compacted-is-listed.md) | 06 |

| What | Source | Task |
| --- | --- | --- |
| `forwardSubagentText: true` | the reference's `claudeSdkOptions.ts:185`; without it a live subagent chat has tool calls only | 03 |
| The chat URI is `ahp-chat://subagent/<base64url session>/<tool call id>` | the reference's `buildSubagentChatUri`; VS Code's `isSubagentChatUri` reads the `subagent` authority | 02 |
| The chat is `read-only`, with origin `{ kind: 'tool', chat, toolCallId }`, and the call carries the matching `subagent` content | the protocol, which requires the two to agree; the reference | 02 |
| `Task` and `Agent` both spawn; title and agent name from `subagent_type`, description from `description`, the opening message from `prompt`; `Subagent` when the call was never seen | the reference's phase 12 Q1 and Q8 | 03 |
| A nested subagent's link goes on the chat of the subagent that spawned it | the reference's `spawningToolParentId` | 03 |
| Any call named by `task_started` is background and ends on a terminal `task_notification`; a call with `run_in_background: false` also ends on its `tool_result`, whichever comes first | the decision above; the reference's phase 12 Q3 and Q17 | 04, 14 |
| A permission ask from inside a subagent is drawn on its chat, through `canUseTool`'s `agentID` | the reference's phase 12 Q13 | 05 |
| An empty round inside a subagent is announced on its chat, closing what `claude/03` left out | `claude/03` task 02, review fix | 03 |
| The host keeps a call's content only for spawning calls, and forgets it with the worker chat or the session | review of this plan: every tool output was kept for the life of the process | 08 |
| A frame for a worker that has ended is dropped; it never reopens the worker | review of this plan | 11 |
| A read of a session's workers that failed is not remembered | `history`'s own rule, `code://packages/sdk/src/host.ts#L4825-L4842` | 13 |
| An ask inside a subagent is tested against a captured stream, not a synthetic call | Softov, 2026-09-26: recapture before the plan closes | 15 |
| A restored worker whose spawning call was compacted out is listed, with no link on a call | the decision above, Softov, 2026-09-26: "List it anyway" | 06 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A subagent seen on a real stream](task-01-a-subagent-on-a-real-stream.md) | implemented | - |
| [02 - The host opens a subagent chat for a backend](task-02-the-host-opens-a-subagent-chat.md) | implemented | - |
| [03 - Claude's subagent frames go to that chat](task-03-subagent-frames-go-to-their-chat.md) | implemented | 01, 02 |
| [04 - A subagent's turn ends, foreground or background](task-04-a-subagent-turn-ends.md) | implemented | 03 |
| [05 - A permission ask inside a subagent is asked there](task-05-asks-inside-a-subagent.md) | implemented | 03 |
| [06 - A subagent's chat is there again after a restart](task-06-restored-after-a-restart.md) | implemented | 03 |
| [07 - Docs and upstream](task-07-docs-and-upstream.md) | implemented | 04, 05, 06 |
| [08 - The host holds a call's content only while a worker needs it](task-08-the-host-holds-only-a-workers-call-content.md) | todo | - |
| [09 - A background worker is linked from its call when the call completes](task-09-a-background-worker-is-linked-on-completion.md) | todo | 08 |
| [10 - The spawning call carries the reference's subagent _meta](task-10-the-spawning-call-carries-the-reference-meta.md) | todo | 08 |
| [11 - A cancelled turn ends its own workers, and an ended worker stays ended](task-11-a-worker-ends-once-and-stays-ended.md) | todo | - |
| [12 - A nested worker is linked from the worker chat that spawned it](task-12-a-nested-worker-is-linked-from-its-parent-worker.md) | todo | - |
| [13 - A resumed session keeps the worker chats it was restored with](task-13-a-resumed-session-keeps-its-restored-workers.md) | todo | - |
| [14 - Any task_started marks a worker background, and a foreground spawn ends on its result](task-14-background-is-told-by-the-reference-rule.md) | todo | 11 |
| [15 - A permission ask inside a subagent, seen on a real stream](task-15-an-ask-inside-a-subagent-on-a-real-stream.md) | todo | - |
| [16 - A worker's own actions are schema-checked, and its comments document](task-16-worker-actions-checked-and-comments-document.md) | todo | 09, 10, 11, 12, 13 |

## Risks and tradeoffs

- The meta file is the CLI's, undocumented; task 06 falls back to the `agentId:` suffix when it is missing.
- `forwardSubagentText` makes a busy subagent as chatty on the wire as the main turn.
- A background subagent whose `task_notification` has no `tool_use_id` never ends; the reference lists the same limit.
- ahpc and ahpapp need to draw a `subagent` content and a read-only chat; VS Code already does.

## Resume state

- **Done so far:** tasks 01 to 07 are `implemented`: the captures, `Start.subagent`, the routing, the endings, the ask routing, the restore and the docs.
- **Next action:** [task-08-the-host-holds-only-a-workers-call-content.md](task-08-the-host-holds-only-a-workers-call-content.md); tasks 11, 12, 13 and 15 do not depend on it and can run beside it, and 14 follows 11.
- **Open questions:** none.
- **Watch out for:** the SDK mock in `test/agent-claude-subagent.test.ts` yields a whole fixture at once, so a cancel or a late frame cannot fall between two frames until task 11 makes it a pull queue; and the fakes in `test/subagent-chat.test.ts` must look like the Claude backend (a `toolKind: 'subagent'` on the spawning call, the nested call present in its parent's chat) or the tests pass without exercising the link.

## Final verification checklist

- [x] A captured stream with a subagent, checked into `test/fixtures`.
- [ ] VS Code: a turn that uses `Task` shows the subagent as its own chat, opened from the call, with its text, thinking and tool calls.
- [ ] VS Code: a permission ask inside the subagent appears in its chat.
- [ ] After a daemon restart the subagent chat is still there.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm boundary` green; the new actions validate against the protocol schema.
- [ ] A captured stream with a permission ask inside a subagent, and the ask test replaying it (task 15).
- [ ] A background worker's spawning call completes with its `subagent` content, and every spawning call carries `subagentDescription`, `subagentAgentName` and `subagentChatUri` (tasks 09, 10).
- [ ] Cancelling a turn leaves an earlier background worker running, and a late frame does not reopen an ended worker (task 11).
- [ ] A foreground worker ends once, on its notification or its result, and a background one only on its notification (task 14).
- [ ] The host holds no content for ordinary tool calls (task 08).
- [ ] A nested worker is linked from its parent worker, live and restored, and a resumed session still lists its restored workers (tasks 12, 13).
- [ ] The worker channel's own actions pass the protocol check (task 16).
- [ ] `UPSTREAM.md`, `docs/`, `plans/index.md` updated.
