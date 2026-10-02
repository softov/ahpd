---
title: Usage, title, plan and mode changes reach the client
domain: acp
status: built
priority: medium
created: 2026-09-26
revalidated: 2026-09-26
requires: []
changes: []
creates: []
decisions: []
refs:
  - "[code://packages/agent-acp/src/mapping.ts#L188-L196](../../../../packages/agent-acp/src/mapping.ts#L188-L196) - every other update returns nothing"
  - "[code://packages/agent-acp/src/session.ts#L256-L283](../../../../packages/agent-acp/src/session.ts#L256-L283) - mode and config updates stored, no `session/configChanged`"
  - "[code://packages/agent-acp/src/session.ts#L861-L866](../../../../packages/agent-acp/src/session.ts#L861-L866) - the title is the first 60 characters of the prompt"
  - "[code://packages/agent-acp/src/transcript.ts#L60-L61](../../../../packages/agent-acp/src/transcript.ts#L60-L61) - `usage: undefined`"
  - npm://@microsoft/agent-host-protocol@0.9.0 - `chat/usage`, `session/titleChanged`, `session/configChanged`
---

## Goal

What the agent reports about a session reaches every client: token usage and cost per turn, the title the agent gave the session, its plan, and a mode or option the agent changed itself.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Gaps

- `usage_update`, `session_info_update` and `plan` are dropped; mode and config updates change nothing a client sees.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| The agent's title replaces the prompt-derived one, and a title a person set is never replaced | (defaulted: the person's words win) | 02 |
| A plan is one `plan` tool call per turn: started on the first plan update, its content replaced by `chat/toolCallContentChanged` on each later one, completed when the turn ends | Softov, 2026-10-02, asked "How should a changing plan be shown?" (a 0.9 response part only appends): "As a tool call" | 04 |

## Proposed architecture

- **Layer responsibilities** - `mapping.ts`: usage and plan · `session.ts`: title and config.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - Usage reaches the turn](task-01-usage.md) | done | - |
| [02 - The agent's title is the session's](task-02-the-agents-title.md) | done | - |
| [03 - A mode or option the agent changed is announced](task-03-mode-and-option-changes.md) | done | - |
| [04 - The agent's plan is shown](task-04-the-plan.md) | done | - |

## Risks and tradeoffs

- A chatty agent sends usage often - one action per update, as the agent sends it; no batching until measured.

## Resume state

- **Done so far:** built 2026-10-02, see [implemented.md](implemented.md).

## Final verification checklist

- [x] A turn shows usage; a session takes the agent's title; a mode the agent changed shows; a plan shows.
- [x] `pnpm test`, `pnpm typecheck` green.
- [x] `plans/index.md` updated.
