---
title: Usage, title, plan and mode changes reach the client
domain: acp
status: planned
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
| A plan is a markdown part, since AHP 0.9 has no plan part | the protocol package at 0.9.0 | 04 |

## Proposed architecture

- **Layer responsibilities** - `mapping.ts`: usage and plan · `session.ts`: title and config.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - Usage reaches the turn](task-01-usage.md) | todo | - |
| [02 - The agent's title is the session's](task-02-the-agents-title.md) | todo | - |
| [03 - A mode or option the agent changed is announced](task-03-mode-and-option-changes.md) | todo | - |
| [04 - The agent's plan is shown](task-04-the-plan.md) | todo | - |

## Risks and tradeoffs

- A chatty agent sends usage often - one action per update, as the agent sends it; no batching until measured.

## Resume state

- **Done so far:** nothing.
- **Next action:** any task; they do not depend on each other.
- **Open questions:** none.
- **Watch out for:** task 02 of plan 09 also emits `session/configChanged`; share one emitter.

## Final verification checklist

- [ ] A turn shows usage; a session takes the agent's title; a mode the agent changed shows; a plan shows.
- [ ] `pnpm test`, `pnpm typecheck` green.
- [ ] `plans/index.md` updated.
