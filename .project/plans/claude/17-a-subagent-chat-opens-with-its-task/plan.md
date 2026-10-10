---
title: A Claude subagent chat opens with its task's description as title and its prompt as the first message
domain: claude
status: built
priority: high
created: 2026-10-04
revalidated: 2026-10-04
requires: []
changes: []
creates: []
decisions: []
refs:
  - "[code://packages/agent-claude/src/session/workers.ts#L203-L243](../../../../packages/agent-claude/src/session/workers.ts#L203-L243) - `scopeFor` opens a worker chat on its first frame, with `subagentType ?? 'Subagent'` and `info?.prompt ?? ''` when the spawn is not recorded yet"
  - "[code://packages/agent-claude/src/session/stream.ts#L326-L334](../../../../packages/agent-claude/src/session/stream.ts#L326-L334) - `assistant()` records the spawn from the canonical message, after the chat may already be open"
  - "[code://packages/agent-claude/src/session/workers.ts#L620](../../../../packages/agent-claude/src/session/workers.ts#L620) - `workerBlock`, the `subagent` content's title"
  - "[code://packages/agent-claude/src/transcript.ts#L155-L160](../../../../packages/agent-claude/src/transcript.ts#L155-L160) - a restored worker chat, titled by agent type too"
  - "[code://packages/sdk/src/host/spawn.ts#L217](../../../../packages/sdk/src/host/spawn.ts#L217) - the host opens the worker's turn with the prompt it is handed"
  - file:///github/externals/vscode/src/vs/platform/agentHost/common/agent.ts#L774-L784 - VS Code 1.140 `subagentChatTitle`: the description cut to 60 characters, else the agent type, else `Subagent`
  - file:///github/externals/vscode/src/vs/platform/agentHost/node/claude/claudeSubagentSignals.ts#L60-L85 - VS Code announces the worker only once its spawn is known, with `taskPrompt` as the opening request
  - "[code://.project/problems/a-claude-call-confirmed-while-streaming-skips-its-bookkeeping.md](../../../problems/a-claude-call-confirmed-while-streaming-skips-its-bookkeeping.md) - the other way the spawn goes unrecorded"
---

## Goal

A subagent's chat opens titled with its task, "Rewrite refs: host 49, 50" rather than "Subagent", and its first turn carries the prompt it was given, live and after a restart, as VS Code does.

## Reconnaissance

### Searches performed

- Session `49665037` on 2026-10-04: six `Agent` calls, each with `description`, `subagent_type` and `prompt` in the main chat's tool calls; each worker chat titled `Subagent` with a first turn of `message.text: ""`.
- The CLI's transcript has each `tool_use` 8-18 ms before its worker's first frame; the daemon still opened every worker chat before `assistant()` recorded its spawn.
- `rg -n "'Subagent'" packages/*/src` - `session.ts:1125`, `:2115`, `transcript.ts:157`, `host/history.ts:104`, `host/snapshots.ts:321`.

### Runtime path

```
worker frame (parent_tool_use_id) -> scopeFor(parent) -> spawning.get(parent) undefined -> options.subagent(title 'Subagent', no prompt) -> turn message ''
assistant() tool_use Agent -> spawning.set(id, { description, prompt, ... }) -> nothing updates the open chat
```

### Gaps

- The worker chat is opened before the spawn is known, and nothing fills it in after.
- The title is the agent type, where VS Code uses the task description.
- A call confirmed through `canUseTool` before its input finished streaming never records the spawn at all (the problem file in refs).

## Decisions locked in

| Decision | Task |
| --- | --- |
| - none | - |

| What | Source | Task |
| --- | --- | --- |
| A worker chat's title is the spawning call's `description` cut to 60 characters, else its `subagent_type`, else `Subagent`, live, restored, and in the `subagent` content block | VS Code 1.140 `subagentChatTitle`; parity per Softov's standing goal | 01, 02 |
| A worker chat opens only once its spawn is recorded; frames that arrive before are held in order and delivered when it opens | VS Code 1.140 announces the worker on the first frame after the spawn is known | 01 |
| The spawn is recorded wherever the call's input is first complete: the canonical message, or the `canUseTool` callback, which is handed the whole input | (defaulted: the input is complete in both, and the callback can run first) | 01 |
| Held frames are released with the fallback title when the spawning call ends or 5 s pass with no spawn recorded, so a worker is never lost | (defaulted: a worker whose spawn is never seen still has a chat to read) | 01 |
| A worker still held when the turn is cancelled is released at once and ended with the turn, so no chat opens after the cancel | Softov, 2026-10-04 | 01 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A live worker chat waits for its spawn](task-01-a-live-worker-chat-waits-for-its-spawn.md) | done | - |
| [02 - A restored worker chat takes the same title](task-02-a-restored-worker-chat-takes-the-same-title.md) | done | - |

## Risks and tradeoffs

- A worker's first frames reach a client a few milliseconds later than now.
- The `canUseTool` part covers only the spawn record; the rest of that problem file stays open.

## Resume state

- **Done so far:** both tasks built 2026-10-04. A worker chat waits for its spawn and opens on the prompt. Its task gives its title, live and when restored. The spawn is recorded from the canonical message or from `canUseTool`, whichever says it first.
- **Next action:** none. Every task was reviewed against main on 2026-10-10 and is `done`; the work is in `7a02145`.

## Final verification checklist

- [ ] A build session that spawns background `Agent` workers: each worker chat is titled with its description and its first turn holds the prompt.
- [ ] After a daemon restart, the same chats keep that title and prompt.
- [x] `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass.
- [x] `plans/index.md` updated.

Not done by hand: the first two. There is no client in this repository to open a session and read the tabs, so both are checked against captures instead - `claude-subagent.jsonl` live with a worker frame delivered ahead of its `tool_use`, and the `.meta.json` fixtures live and restored. What neither can show is the titles in a real session list.
