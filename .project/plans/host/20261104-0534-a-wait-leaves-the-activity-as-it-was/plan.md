---
title: A wait leaves the activity as it was
domain: host
status: planned
priority: medium
created: 2026-11-04
revalidated: 2026-11-04
refs:
  - git://6dbd3ea7 - the commit of ahpd the facts were checked at, and the last commit that holds briefs/a-waiting-session-names-its-tool.md
  - "[code://packages/agent-claude/src/session/asking.ts#L439](../../../../packages/agent-claude/src/session/asking.ts#L439) - Claude sets `Waiting on you: <displayName>` when a confirmation waits"
  - "[code://packages/agent-claude/src/session/asking.ts#L693](../../../../packages/agent-claude/src/session/asking.ts#L693) - after an answer, Claude names the approved tool, or says `Thinking` on deny"
  - "[code://packages/agent-claude/src/session/parts.ts#L57-L61](../../../../packages/agent-claude/src/session/parts.ts#L57-L61) - `busyWith`: the line Claude says for a running tool, the pattern task 02 copies"
  - "[code://packages/agent-claude/src/session/stream.ts#L427](../../../../packages/agent-claude/src/session/stream.ts#L427) - Claude names a tool when it starts"
  - "[code://packages/agent-claude/src/session/stream.ts#L579-L581](../../../../packages/agent-claude/src/session/stream.ts#L579-L581) - Claude goes back to `Thinking` when a tool completes"
  - "[code://packages/agent-pi/src/session.ts#L663](../../../../packages/agent-pi/src/session.ts#L663) - pi sets `Waiting on you: <displayName>` when a confirmation waits"
  - "[code://packages/agent-acp/src/session/handlers.ts#L637](../../../../packages/agent-acp/src/session/handlers.ts#L637) - ACP sets `Waiting on you` when a confirmation waits"
  - "[code://packages/agent-acp/src/session/handlers.ts#L777](../../../../packages/agent-acp/src/session/handlers.ts#L777) - ACP sets `Waiting on you` when a question waits"
  - "[code://packages/agent-cofold/src/runs.ts#L291](../../../../packages/agent-cofold/src/runs.ts#L291) - `reopen` sets `Waiting on you` after it replays a paused run"
  - "[code://packages/agent-cofold/src/runs.ts#L105-L106](../../../../packages/agent-cofold/src/runs.ts#L105-L106) - `apply`, which every live and replayed cofold event goes through"
  - "[code://packages/agent-cofold/src/mapping.ts#L49-L56](../../../../packages/agent-cofold/src/mapping.ts#L49-L56) - `MappedEvent`, what the mapping hands `apply` for one event"
  - "[code://packages/agent-cofold/src/mapping.ts#L691-L760](../../../../packages/agent-cofold/src/mapping.ts#L691-L760) - `tool.started`, `tool.completed` and `tool.denied` in the mapping"
  - "[code://packages/agent-cofold/src/tools.ts#L281](../../../../packages/agent-cofold/src/tools.ts#L281) - `describe`: a call's subject, or its name"
  - "[code://examples/notes/agent.ts#L276](../../../../examples/notes/agent.ts#L276) - the example agent sets `Waiting on you` on a question"
  - "[code://examples/notes/agent.ts#L356](../../../../examples/notes/agent.ts#L356) - the example agent sets `Waiting on you: <displayName>` on a confirmation"
  - https://github.com/microsoft/vscode/blob/171e90619c7/src/vs/platform/agentHost/node/copilot/copilotAgentSession.ts#L11165-L11172 - VS Code sets its activity from intents, commands, the local model and fusion, and never on a wait
  - https://github.com/microsoft/vscode/blob/171e90619c7/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostSessionListController.ts#L28-L31 - VS Code shows a wait by the `InputNeeded` status alone
---

## Goal

A session that waits on the person says so once, by its status.
Today the activity says it a second time, so an ahpc row shows "waiting on you" twice.
No agent changes its activity when a confirmation or a question waits, as in VS Code.
cofold names each tool while it runs, as Claude does.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "Waiting on you" packages examples docs` - five places in four agents, and two in the example agent. No test and no doc reads the text.
- `rg -n "doing\(|activity.say" packages/agent-cofold/src` - cofold says `Thinking` at a turn start, `Running` for a `!` command, and nothing per tool.
- `git grep -n "_publishActivity(" src/vs/platform/agentHost/node` in VS Code `171e90619c7` - no activity on a wait and no activity per tool. Its Claude and Codex hosts send no activity.

### Runtime path

```
confirmation or question waits -> (no activity change) -> session/inputNeededSet -> InputNeeded status -> the client row says it waits
cofold tool.started -> mapping says the line -> apply -> activity "<displayName> <subject>" -> tool.completed or tool.denied -> "Thinking"
```

### Gaps

- `Waiting on <owner>: <tool>` in Claude and pi is a wait on a client that runs a tool, not on the person. It stays.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A wait for a confirmation or a question does not change the activity, and the status alone says the session waits | Softov, 2026-11-04, chose "Leave it as it was" | 01 |
| Claude, cofold, pi and ACP all follow it | Softov, 2026-11-04, chose "All four agents" | 01 |
| The example agent in `examples/notes` follows it too | (defaulted: an example teaches the pattern) | 01 |
| `reopen` in cofold sets no activity after a replay | Softov, 2026-11-04, chose "Leave it as it was" | 01 |
| cofold names each tool when it starts, and says `Thinking` when it completes or is denied | Softov, 2026-11-04, chose "Yes, name every running tool" | 02 |
| cofold's line is `<displayName> <subject>`, or `<displayName>` with no subject, with whitespace collapsed and cut to 80 characters | (defaulted: the shape of Claude's `busyWith`, with cofold's display name) | 02 |
| The mapping says the line, in a new `doing` field of `MappedEvent`, and `apply` says it | (defaulted: the mapping holds the call's display name and subject) | 02 |
| `Waiting on <owner>: <tool>` for a client's tool stays | (defaulted: it is a wait on a client, not on the person) | - |

## Proposed architecture

- **Data flow** - cofold's mapping returns `doing` on `tool.started`, `tool.completed` and `tool.denied`; `apply` passes it to `ctx.activity.say`.
- **Event flow** - no new action. `session/activityChanged` and `chat/activityChanged` go out less often on a wait, and more often in a cofold turn.
- **State flow** - the activity keeps its last value while a request waits.
- **Layer responsibilities** - agent-claude, agent-pi, agent-acp: remove the wait text · agent-cofold: remove the wait text in `reopen`, and name running tools · examples: remove the wait text.
- **Source-of-truth files** - [`code://packages/agent-cofold/src/mapping.ts`](../../../../packages/agent-cofold/src/mapping.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - no agent says waiting on you](task-01-no-agent-says-waiting-on-you.md) | implemented | - |
| [02 - cofold names its running tool](task-02-cofold-names-its-running-tool.md) | implemented | 01 |

## Risks and tradeoffs

- A client that shows only the activity no longer sees a wait in it - ahpc, ahpw and VS Code read the status.
- A replayed cofold run now says the last tool line it replays - the status says the run waits, as in Claude.

## Resume state

- **Done so far:** both tasks are implemented on 2026-11-04. Each new test fails without its change.
- **Next action:** review, then the PR.
- **Watch out for:** a cofold tool of its own is named by its tool name, such as `read_file a.txt`, as its tool call row is. A replayed cofold run says the last tool line it replays.

## Final verification checklist

- [x] `rg -n "Waiting on you" packages/*/src examples` finds nothing.
- [x] Each of the four agents has a test that reads the activity while a confirmation waits.
- [x] A cofold test reads the tool line on `tool.started` and `Thinking` after `tool.completed` and `tool.denied`.
- [x] `pnpm build`, `pnpm typecheck` and `pnpm boundary` pass, and the tests of agent-claude, agent-pi, agent-acp and agent-cofold pass.
