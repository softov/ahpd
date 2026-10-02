---
title: A turn ends as the agent ended it
domain: acp
status: built
priority: high
created: 2026-09-26
revalidated: 2026-09-26
requires: []
changes: []
creates: []
decisions: []
refs:
  - "[code://packages/agent-acp/src/session.ts#L987-L997](../../../../packages/agent-acp/src/session.ts#L987-L997) - cancel: `session/cancel`, permissions left pending"
  - "[code://packages/agent-acp/src/session.ts#L714](../../../../packages/agent-acp/src/session.ts#L714) - every stop reason but `cancelled` ends as complete"
  - "[code://packages/agent-acp/src/session.ts#L634-L668](../../../../packages/agent-acp/src/session.ts#L634-L668) - `finish`"
  - https://agentclientprotocol.com/protocol/prompt-turn - on cancel the client must answer pending permission requests with `cancelled`; the stop reasons
---

## Goal

Cancelling a turn answers every permission the server is waiting on with `cancelled` and removes its input-needed entry, as the protocol requires.
A turn the agent stopped for `max_tokens`, `max_turn_requests` or `refusal` ends as an error saying which, not as a finished answer.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Gaps

- Pending permissions stay pending after a cancel.
- `max_tokens`, `max_turn_requests` and `refusal` end as `chat/turnComplete`.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| The stop reason is the `chat/error` error type | the research of 2026-09-26: one name for one cause | 02 |

## Proposed architecture

- **Layer responsibilities** - `session.ts` only.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - Cancel settles every pending permission](task-01-cancel-settles-every-permission.md) | done | - |
| [02 - A stop that is not an answer is an error](task-02-a-stop-that-is-not-an-answer-is-an-error.md) | done | - |

## Risks and tradeoffs

- A client that shows `refusal` as an error may alarm - the sentence says the agent declined, not that something broke.

## Resume state

- **Done so far:** built 2026-10-02, see [implemented.md](implemented.md).

## Final verification checklist

- [x] A cancel leaves no pending permission.
- [x] Each non-answer stop reason is an error with its name.
- [x] `pnpm test`, `pnpm typecheck` green.
- [x] `plans/index.md` updated.
