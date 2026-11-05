---
title: An agent asks the person
domain: host
status: built
priority: high
created: 2026-11-03
revalidated: 2026-11-03
requires: []
changes:
  - specs/agent-backends.md
refs:
  - git://14beb809 - the commit of ahpd this plan was checked at
  - "[code://packages/sdk/src/types/host.ts#L1137-L1318](../../../../packages/sdk/src/types/host.ts#L1137-L1318) - `ToolCall`, with no `ask`"
  - "[code://packages/sdk/src/host/chatactions.ts#L1804-L1860](../../../../packages/sdk/src/host/chatactions.ts#L1804-L1860) - `chat/inputCompleted`, which hands every answer to the backend's `session.answer`"
  - "[code://packages/sdk/src/types/session.ts#L845-L862](../../../../packages/sdk/src/types/session.ts#L845-L862) - `Session.answer` and `setAnswer`"
  - "[code://packages/agent-claude/src/session/asking.ts#L346-L357](../../../../packages/agent-claude/src/session/asking.ts#L346-L357) - Claude's own question, sent as `chat/inputRequested`"
  - "[code://packages/agent-claude/src/session/asking.ts#L775-L835](../../../../packages/agent-claude/src/session/asking.ts#L775-L835) - Claude's answer path"
  - "[code://packages/agent-cofold/src/turnagent.ts#L316-L358](../../../../packages/agent-cofold/src/turnagent.ts#L316-L358) - cofold drops its own `ask_user` when a host tool takes the name"
  - "[code://packages/agent-cofold/src/mapping.ts#L637-L657](../../../../packages/agent-cofold/src/mapping.ts#L637-L657) - cofold's own question, sent as `chat/inputRequested`"
  - "[code://packages/agent-pi/src/tools.ts#L26-L82](../../../../packages/agent-pi/src/tools.ts#L26-L82) - pi drops a host tool by name, the pattern for Claude to drop `ask_user`"
  - "[code://packages/sdk/src/tools/index.ts#L24-L56](../../../../packages/sdk/src/tools/index.ts#L24-L56) - `hostTools`"
  - npm://@cofold/agents@0.4.0 - `dist/tool/ask-user.js`: the input of `ask_user`, and `validateAnswers`
  - npm://@microsoft/agent-host-protocol@1.0.0 - `chat/inputRequested` and `chat/inputCompleted`
---

## Goal

An agent asks the person questions in the chat and waits for the answers, with the host's own `ask_user` tool.
VS Code's shell tool tells the model to use `ask_user` when a command waits for input.
pi and ACP agents have no tool for it.
Cofold already gives its own `ask_user` name to a host tool, so cofold uses the host's.
Claude keeps its own question tool for now; *deferred.md* says what waits.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "chat/inputRequested" packages/sdk/src` - only a type check; the host sends no question of its own.
- `rg -n "ask_user|inputRequested" packages/agent-*/src` - Claude, cofold, ACP and the bot each send their own question.

### Runtime path

```
model calls ask_user -> ToolCall.ask(questions) -> chat/inputRequested on the chat -> client answers
  -> chat/inputCompleted -> the host settles its own request -> the tool returns the answers as text
```

### Gaps

- A host tool cannot ask the person anything.
- `chat/inputCompleted` goes to the backend even for a request the host sent.

## Answers

| What | Source | Task |
| --- | --- | --- |
| `ask_user` is ahpd's own code in the sdk, with no import from cofold. A new `ask` on `ToolCall` sends `chat/inputRequested` and waits for the answer | Softov, 2026-10-27 | 01 |
| Every backend but Claude is offered `ask_user`. Claude waits, as *deferred.md* says | Softov, 2026-11-03: "every but claude... claude put on pending. as future change" | 02 |
| The input is cofold's: up to four questions, each with an id, a header, options with descriptions, `multiSelect` and `allowOther` | Softov, 2026-11-03, chose "cofold's shape" | 02 |
| Claude drops a host tool named `ask_user`, as pi drops a host tool named like its own | (defaulted: the sibling pattern in `agent-pi/src/tools.ts`) | 02 |
| A declined or cancelled question returns that to the model as the tool's answer, not as an error | (defaulted: the model must know the person said no) | 01 |

## Proposed architecture

- **Data flow** - `ask` builds the request, holds a settle for its id, and returns the answers.
- **Event flow** - the host sends `chat/inputRequested`. `chat/inputCompleted` for that id settles the host's request and never reaches the backend.
- **State flow** - the chat's reducer holds the pending request, as for a backend's question.
- **Layer responsibilities** - `@ahpd/sdk`: `ask`, the held requests and the tool · `@ahpd/agent-claude`: drops the tool.
- **Source-of-truth files** - [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - a host tool asks the person](task-01-a-host-tool-asks-the-person.md) | done | - |
| [02 - the ask_user tool](task-02-the-ask-user-tool.md) | done | 01 |

## Risks and tradeoffs

- MayCXC's union of 2026-11-03 changes `chatactions.ts`. Build on main after it merges, or merge it into the branch first.
- A question that nobody answers keeps the turn open. A stop of the turn cancels it, as a backend's question is cancelled.

## Resume state

- **Done so far:** built in #210, and Softov checked it by hand on Linux on 2026-11-04. See [implemented.md](implemented.md).
- **Next action:** the check on Windows and macOS in [host-1620-terminal-tool-checks.md](../../../pending/host-1620-terminal-tool-checks.md).

## Final verification checklist

- [x] `pnpm build`, `pnpm typecheck` and `pnpm boundary` pass.
- [x] The sdk, agent-claude, agent-pi and agent-cofold suites pass, one at a time.
- [x] On a test daemon, a pi session's `ask_user` question shows in ahpc, and the answer reaches the model.
