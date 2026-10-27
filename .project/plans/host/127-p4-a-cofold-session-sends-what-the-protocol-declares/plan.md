---
title: A cofold session sends what the protocol declares
domain: host
status: planned
priority: high
created: 2026-10-27
revalidated: 2026-10-27
requires:
  - plans/host/127-every-agent-sends-what-the-protocol-declares/plan.md
  - plans/host/127-p1-the-host-describes-every-agent/plan.md
refs:
  - "[code://packages/agent-cofold/src/tools.ts#L278-L295](../../../../packages/agent-cofold/src/tools.ts#L278-L295) - `toolCallPart`, which makes a tool call part with an `id`"
  - "[code://packages/agent-cofold/src/mapping.ts#L437-L449](../../../../packages/agent-cofold/src/mapping.ts#L437-L449) - the compaction notice, made with an `id`"
  - "[code://packages/agent-cofold/src/mapping.ts#L462-L468](../../../../packages/agent-cofold/src/mapping.ts#L462-L468) - the notice of a command's output, made with an `id`"
  - "[code://packages/agent-cofold/src/mapping.ts#L569](../../../../packages/agent-cofold/src/mapping.ts#L569) - the part of a call the run never proposed, made with an `id`"
  - "[code://packages/agent-cofold/src/transcript.ts#L408](../../../../packages/agent-cofold/src/transcript.ts#L408) - the part of a restored call, made with an `id`"
  - "[code://packages/agent-cofold/src/pauses.ts#L215](../../../../packages/agent-cofold/src/pauses.ts#L215) - a decision's call, found by a part `id`"
---

## Goal

A cofold session keeps an `id` on each tool call part and on its two kinds of notice, which the protocol does not declare.
With this plan, a cofold part is the protocol's part, and a decision finds its call by the call's own id.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- The case drives two calls through `createHost` and reports `responseParts/N undeclared key id` twice.
- The compaction case reduces the actions a notice went out in, and its parts carry an `id`.
- `rg -n "one.id === held.callId" packages/agent-cofold/src` - one lookup of a call by a part `id`.

### Runtime path

```
a run event -> mapping -> a part, and actions -> the snapshot, and the reducer of a watching client
```

### Gaps

- A tool call part and a notice carry an `id`, and one lookup depends on it.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A tool call part holds `kind` and `toolCall`, and a decision finds it by the call's own id. | `ToolCallResponsePart` in npm://@microsoft/agent-host-protocol@1.0.0 | 01 |
| A notice holds `kind` and `content`. | `SystemNotificationResponsePart` in npm://@microsoft/agent-host-protocol@1.0.0 | 01 |

## Proposed architecture

- **Data flow** - each part the session holds is the protocol's part.
- **Event flow** - no change.
- **State flow** - no change.
- **Layer responsibilities** - `@ahpd/agent-cofold`: its parts.
- **Source-of-truth files** - [`code://packages/agent-cofold/src/tools.ts`](../../../../packages/agent-cofold/src/tools.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A cofold part is the protocol's](task-01-a-cofold-part-is-the-protocols.md) | done | - |

## Risks and tradeoffs

- none.

## Resume state

- **Done so far:** planned and built 2026-10-27; see [implemented.md](implemented.md).
- **Next action:** none.
- **Open questions:** none.
- **Watch out for:** a notice's count was only its id, and goes with it.

## Final verification checklist

- [x] The new cases fail on the session before this change.
- [x] `plans/index.md` updated.
