---
title: A pi session sends what the protocol declares
domain: host
status: planned
priority: high
created: 2026-10-27
revalidated: 2026-10-27
requires:
  - plans/host/127-every-agent-sends-what-the-protocol-declares/plan.md
refs:
  - "[code://packages/agent-pi/src/mapping.ts#L31-L34](../../../../packages/agent-pi/src/mapping.ts#L31-L34) - `partOf` and `rowOf`, which find a prose part and a call by one `id`"
  - "[code://packages/agent-pi/src/mapping.ts#L95-L108](../../../../packages/agent-pi/src/mapping.ts#L95-L108) - a call's part, made with an `id`"
  - "[code://packages/agent-pi/src/mapping.ts#L414-L470](../../../../packages/agent-pi/src/mapping.ts#L414-L470) - a call's end, which keeps part of the result it sends"
  - "[code://packages/agent-pi/src/session.ts#L1115-L1165](../../../../packages/agent-pi/src/session.ts#L1115-L1165) - a person's shell command, whose part keeps neither its ready nor its result"
  - "[code://packages/agent-pi/src/session.ts#L343](../../../../packages/agent-pi/src/session.ts#L343) - a released question's call, found by a part `id`"
  - "[code://packages/agent-pi/src/replay.ts#L171](../../../../packages/agent-pi/src/replay.ts#L171) - a replayed call, found by a part `id`"
---

## Goal

A pi session keeps an `id` on each tool call part, which the protocol does not declare.
Its shell command keeps neither the line its ready sent nor the result its completion sent.
A completed call keeps no content, though its completion carried the result's.
With this plan, a pi part is the protocol's part, and its snapshot holds the calls a watching client built.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- The case drives a call pi ran and a shell command through `createHost`.
- It reports `responseParts/N undeclared key id` twice, and a completed call with no `invocationMessage` and no `confirmed`.
- With the frames clean, the late calls differ from the replayed ones: a completed call has no `content`.
- `rg -n "one.id === " packages/agent-pi/src` - four lookups of a call by a part `id`.

### Runtime path

```
a pi event -> mapEvent -> a part, and actions -> the snapshot, and the reducer of a watching client
```

### Gaps

- A tool call part carries an `id`, and the lookups depend on it.
- The record of a call misses what its actions said.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A tool call part holds `kind` and `toolCall`, and `callPartOf` finds it by the call's own id. | `ToolCallResponsePart` in npm://@microsoft/agent-host-protocol@1.0.0 | 01 |
| A prose part keeps its own `id`, which the protocol declares. | `MarkdownResponsePart` and `ReasoningResponsePart` in npm://@microsoft/agent-host-protocol@1.0.0 | 01 |
| A ready and a completion put their fields onto the held call from the object they send. | [code://packages/agent-claude/src/session/stream.ts#L573-L583](../../../../packages/agent-claude/src/session/stream.ts#L573-L583) | 01 |
| A completion drops the content the call showed while it ran. | The chat reducer's `ChatToolCallComplete` in npm://@microsoft/agent-host-protocol@1.0.0 | 01 |

## Proposed architecture

- **Data flow** - each part the session holds is the protocol's part, with the fields its actions sent.
- **Event flow** - no change.
- **State flow** - a held call follows the reducer.
- **Layer responsibilities** - `@ahpd/agent-pi`: its parts.
- **Source-of-truth files** - [`code://packages/agent-pi/src/mapping.ts`](../../../../packages/agent-pi/src/mapping.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A pi part is the protocol's](task-01-a-pi-part-is-the-protocols.md) | todo | - |

## Risks and tradeoffs

- none.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-a-pi-part-is-the-protocols.md](task-01-a-pi-part-is-the-protocols.md).
- **Open questions:** none.
- **Watch out for:** the suites that read a call by its part `id` read it by the call's id.

## Final verification checklist

- [ ] The new case fails on the session before this change.
- [ ] `plans/index.md` updated.
