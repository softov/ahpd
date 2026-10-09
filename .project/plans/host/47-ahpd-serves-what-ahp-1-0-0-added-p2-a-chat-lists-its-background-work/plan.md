---
title: A chat lists the shells and subagents running in its background
domain: host
status: built
priority: medium
created: 2026-10-03
revalidated: 2026-10-04
requires:
  - plans/host/47-ahpd-serves-what-ahp-1-0-0-added/plan.md
  - plans/host/44-ahpd-speaks-ahp-1-0-0-p1-ahpd-speaks-1-0-0-and-0-9-0/plan.md
refs:
  - "[code://packages/agent-claude/src/session.ts#L971-L995](../../../../packages/agent-claude/src/session.ts#L971-L995) - `Spawning`, `background` and `tasks`: the calls `task_started` named and their task ids, kept for ending workers and for `stopTask`"
  - "[code://packages/agent-claude/src/session.ts#L1059-L1070](../../../../packages/agent-claude/src/session.ts#L1059-L1070) - `scopeOfCall` and `emitOn`, which put an action on the chat whose agent made the call"
  - "[code://packages/agent-claude/src/session.ts#L2800-L2826](../../../../packages/agent-claude/src/session.ts#L2800-L2826) - `task_started` and `task_notification`, read today only to end a worker"
  - "[code://packages/agent-claude/src/session.ts#L3134-L3155](../../../../packages/agent-claude/src/session.ts#L3134-L3155) - `chatState`, the lead chat's snapshot, built by hand"
  - "[code://packages/agent-claude/src/session.ts#L3790-L3795](../../../../packages/agent-claude/src/session.ts#L3790-L3795) - `close`, which clears `background`"
  - "[code://packages/agent-claude/test/fixtures/claude-subagent-background.jsonl](../../../../packages/agent-claude/test/fixtures/claude-subagent-background.jsonl) - a real capture: `background_tasks_changed` before `task_started`, and an empty one before the `task_notification`"
  - "[code://packages/agent-claude/test/agent-claude-subagent.test.ts#L20-L90](../../../../packages/agent-claude/test/agent-claude-subagent.test.ts#L20-L90) - the fake SDK feed the new tests reuse"
  - "[code://packages/sdk/src/host/spawn.ts#L79-L85](../../../../packages/sdk/src/host/spawn.ts#L79-L85) - a worker chat's state is the package's `chatReducer` over what the backend emitted, so it needs no change"
  - "[code://packages/sdk/src/nested.ts#L305-L312](../../../../packages/sdk/src/nested.ts#L305-L312) - a nested host reduces its inner host's chat actions with `chatReducer`"
  - "[code://packages/sdk/src/nested.ts#L427](../../../../packages/sdk/src/nested.ts#L427) - and answers that reduced state as its `chatState`"
  - "[code://packages/sdk/test/conformance.test.ts](../../../../packages/sdk/test/conformance.test.ts) - the Claude backend through the host, every action replayed through the package's reducers"
  - "npm://@anthropic-ai/claude-agent-sdk@0.3.278 - `SDKBackgroundTasksChangedMessage`: the full set of live background tasks, replace semantics, reset when the CLI process restarts, `ambient` tasks excluded from activity; `SDKTaskStartedMessage`: `task_id`, `tool_use_id`, `description`, `task_type` (`local_bash`, `local_agent`), `is_backgrounded`; `SDKTaskNotificationMessage` ends one (`sdk.d.ts:3495-3520`, `:5648-5745`)"
  - "npm://@microsoft/agent-host-protocol@1.0.0 - `ChatState.backgroundWork`, only active work, absent from `ChatSummary` (`channels-chat/state.ts:113-123`); `BackgroundShellWork` and `BackgroundSubagentWork`, `id` unique per chat and opaque, `subagent.chat` the same chat the spawning call links (`:220-301`); `chat/backgroundWorkSet` upserts by `id`, `chat/backgroundWorkRemoved` of an unknown id is a no-op (`channels-chat/actions.ts:555-577`, reducer `channels-chat/reducer.ts:455-476`)"
  - "https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/copilot/copilotAgentSession.ts#L1996-L2064 - VS Code's Copilot backend: reconciles the runtime's task list, removes what it no longer reports, ids `shell:<id>` and `subagent:<id>`, a shell only when not synchronous, a subagent only while running in the background"
  - "https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/common/agent.ts#L1410-L1416 - `watchChatBackgroundWork`, optional per provider; VS Code's Claude backend does not implement it"
  - "https://github.com/microsoft/agent-host-protocol/pull/482 - chat background work"
---

## Goal

A client subscribed to a chat sees what that chat's agent left running: a shell started in the background and a subagent working in the background, each with what it is and when it started, gone from the list once it ends.
The Claude backend reports both; every other backend reports none, because nothing it runs on says so.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n -i "background" packages/agent-acp/src packages/agent-pi/src packages/agent-cofold/src` - one comment in cofold about a question asked in the background; none of the three has a background task to report.
- `grep -n "task_started\|background_tasks_changed\|task_type" sdk.d.ts` in the installed Claude Agent SDK - the edge messages carry the details and the level message carries membership; `local_bash` and `local_agent` both set `is_backgrounded`.
- `rg -n "backgroundWork" src/vs/platform/agentHost` in the VS Code clone - only the Copilot backend publishes it; `node/claude/` has nothing.

### Runtime path

```
SDK background_tasks_changed / task_started / task_notification
  -> agent-claude: live ids x task details -> chat/backgroundWorkSet | chat/backgroundWorkRemoved on the call's chat
  -> host dispatch -> subscribers; chatState() and a worker's reduced state carry backgroundWork for a late subscriber
```

### Gaps

- `task_started` is read only to end a worker, and `background_tasks_changed` is not read at all.
- A shell the agent left running in the background is invisible to a client.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| Only the Claude backend reports background work; ACP, pi and cofold report none, and a nested host passes on what its inner host reports | the backends' own signals: the SDK's task messages, and nothing in the other three; [`code://packages/sdk/src/nested.ts#L305-L312`](../../../../packages/sdk/src/nested.ts#L305-L312) | 01, 02 |
| Which tasks are live is `background_tasks_changed`, replacing the set each time; what each one is comes from its `task_started` | Claude Agent SDK: "consumers ... should replace their set with each payload rather than pairing edges, so a missed bookend cannot wedge a stale running indicator"; VS Code reconciles from the runtime's task list the same way | 01 |
| An entry's `id` is `shell:<task_id>` or `subagent:<task_id>`, its `label` the task's `description`, its `startedAt` when `task_started` arrived | (defaulted: VS Code's ids, and the SDK gives no start time) | 01 |
| A shell entry carries no `terminal` and neither kind carries `_meta` | (defaulted: no ahpd terminal carries a Claude `Bash` call's output, and VS Code's `_meta` keys are Copilot's own) | 01 |
| An `ambient` task is never listed, and a task with no `task_started` seen is not listed until one arrives | Claude Agent SDK `ambient`: "hosts should exclude them from activity indicators"; (defaulted: an entry needs the call to know its chat) | 01 |
| A subagent entry is listed at its `task_started`, and its `chat` is the URI its worker chat has, built from the spawning call's id as `subagentChatUri` builds it; the worker chat still opens when claude/17 says; with no subagent seam the subagent is not listed | AHP 1.0.0 `BackgroundSubagentWork.chat`: "the same chat the spawning tool call's `ToolResultSubagentContent.resource` points to"; Softov, 2026-10-09, asked how the entry is made when the worker chat opens one message after `task_started`: "Now, link by call id"; VS Code `copilotAgentSession.ts#L2056-L2064` builds the chat from `task.toolCallId` | 01 |
| Work is published whenever the SDK says so, not only while a client watches | (defaulted: the SDK pushes; VS Code's watch exists because Copilot's runtime is polled) | 01 |
| Sent to a 0.9.0 connection too, and no grant beyond reading the chat (`session:read` today, `chat:read` after host/46) | AHP 1.0.0 `ACTION_INTRODUCED_IN`: both actions `0.9.0`; both are host-emitted, not client-dispatchable | 01, 02 |

## Proposed architecture

- **Data flow** - `task_started` -> `taskInfo[task_id] = { kind, toolUseId, description, startedAt }`; `background_tasks_changed` -> `live = ids not ambient`; reconcile -> the set of entries -> diff against what each chat was told -> `chat/backgroundWorkSet` / `chat/backgroundWorkRemoved` through `emitOn(scopeOfCall(toolUseId))`.
- **State flow** - agent-claude keeps the told entries per chat; the lead chat's `chatState()` lists its own, a worker chat's state is reduced by the host.
- **Layer responsibilities** - agent-claude: the whole feature · sdk: nothing new, a test that the actions reach a client and survive the conformance replay · docs: the two action rows.
- **Source-of-truth files** - [`code://packages/agent-claude/src/session.ts`](../../../../packages/agent-claude/src/session.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The Claude backend lists its background shells and subagents](task-01-the-claude-backend-lists-its-background-work.md) | done | - |
| [02 - A client reads a chat's background work through the host](task-02-a-client-reads-a-chats-background-work.md) | done | 01 |

## Risks and tradeoffs

- The level and the edges arrive in no fixed order (the capture has the level first), so reconciling on both is what keeps an entry from flickering.
- A process restart resets the level; nothing is emitted at startup, so a resumed session lists nothing until the next change, which is the SDK's own contract.

## Resume state

- **Done so far:** tasks 01 and 02, reviewed and gated on main.
- **Next action:** none; see [implemented.md](implemented.md).
- **Open questions:** none.
- **Watch out for:** `background` in `session.ts` holds every call `task_started` named, foreground ones included, for ending workers; it is not the background-work list and must not become it. A subagent entry's `chat` is built with `subagentChatUri`, so a change to that name moves the entry with it.

## Final verification checklist

- [x] A backgrounded subagent in the capture is listed on the lead chat from its `task_started` to the empty level, and gone after.
- [x] `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass.
- [x] `plans/index.md` updated.
