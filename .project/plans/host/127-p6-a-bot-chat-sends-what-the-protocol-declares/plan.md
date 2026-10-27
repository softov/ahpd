---
title: A bot chat sends what the protocol declares
domain: host
status: planned
priority: high
created: 2026-10-27
revalidated: 2026-10-27
requires:
  - plans/host/127-every-agent-sends-what-the-protocol-declares/plan.md
refs:
  - "[code://packages/bot/src/chat.ts#L501-L507](../../../../packages/bot/src/chat.ts#L501-L507) - the call that shows the back session, made with an `id`"
  - "[code://packages/bot/src/chat.ts#L604](../../../../packages/bot/src/chat.ts#L604) - the call a back session asks about, made with an `id`"
---

## Goal

A bot chat keeps an `id` on each tool call part, which the protocol does not declare.
With this plan, a bot chat's part is the protocol's part.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- The case drives a turn that wakes a back session through `createHost`, and reports `responseParts/N undeclared key id`.
- `rg -n "one.id === " packages/bot/src` - no lookup reads a part `id`.

### Runtime path

```
a turn -> a call on the back session -> the snapshot of a late client
```

### Gaps

- A tool call part carries an `id`.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A tool call part holds `kind` and `toolCall`. | `ToolCallResponsePart` in npm://@microsoft/agent-host-protocol@1.0.0 | 01 |

## Proposed architecture

- **Data flow** - each part the chat holds is the protocol's part.
- **Event flow** - no change.
- **State flow** - no change.
- **Layer responsibilities** - `@ahpd/bot`: its parts.
- **Source-of-truth files** - [`code://packages/bot/src/chat.ts`](../../../../packages/bot/src/chat.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A bot part is the protocol's](task-01-a-bot-part-is-the-protocols.md) | todo | - |

## Risks and tradeoffs

- none.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-a-bot-part-is-the-protocols.md](task-01-a-bot-part-is-the-protocols.md).
- **Open questions:** none.
- **Watch out for:** nothing more.

## Final verification checklist

- [ ] The new case fails on the chat before this change.
- [ ] `plans/index.md` updated.
