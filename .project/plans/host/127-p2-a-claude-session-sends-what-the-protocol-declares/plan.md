---
title: A Claude session sends what the protocol declares
domain: host
status: built
priority: high
created: 2026-10-27
revalidated: 2026-10-27
requires:
  - plans/host/127-every-agent-sends-what-the-protocol-declares/plan.md
  - plans/claude/07-a-turn-ends-with-no-call-left-open/plan.md
refs:
  - "[code://packages/agent-claude/src/session/stream.ts#L221](../../../../packages/agent-claude/src/session/stream.ts#L221) - a streamed call's part, made with an `id`"
  - "[code://packages/agent-claude/src/session/stream.ts#L405](../../../../packages/agent-claude/src/session/stream.ts#L405) - an assistant message's call part, made with an `id`"
  - "[code://packages/agent-claude/src/session/asking.ts#L404](../../../../packages/agent-claude/src/session/asking.ts#L404) - the part of a call asked about before the stream showed it, made with an `id`"
  - "[code://packages/agent-claude/src/session/turns.ts#L369](../../../../packages/agent-claude/src/session/turns.ts#L369) - the part of a person's shell command, made with an `id`"
  - "[code://packages/agent-claude/src/transcript.ts#L424](../../../../packages/agent-claude/src/transcript.ts#L424) - the part of a restored call, made with an `id`"
  - "[code://packages/agent-claude/src/session/query.ts#L645-L660](../../../../packages/agent-claude/src/session/query.ts#L645-L660) - the compaction notice, made with an `id`"
  - "[code://packages/agent-claude/src/session/stream.ts#L150-L165](../../../../packages/agent-claude/src/session/stream.ts#L150-L165) - the round notice, which says a notice has no id"
  - "[code://packages/sdk/test/wire.test.ts#L248](../../../../packages/sdk/test/wire.test.ts#L248) - the `_meta` census entry for `toolKind`, on an action only"
  - "[code://docs/sdk/AHP.md#L266](../../../../docs/sdk/AHP.md#L266) - `toolKind` is on the call in a snapshot as on the action"
---

## Goal

A Claude session keeps an `id` on each tool call part and on its compaction notice, and a chat's snapshot is that record.
The protocol declares neither key, so a client that subscribes late, or watches a compaction, receives one.
The wire suite never reads a chat after its turn, so it never saw a part.
With this plan, Claude's parts are the protocol's, and the wire suite reads the chat after its turn.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- The strict schema reports `ChatState /turns/N/responseParts/N undeclared key id` for a part as agent-claude keeps it.
- The compaction case reports `ChatResponsePartAction /part undeclared key id`.
- With the chat asked for again after its turn, the wire suite finds the `id`, and its `_meta` census finds `toolKind` on the call.
- `rg -n "kind: 'toolCall'" packages/agent-claude/src` - five places make a tool call part with an `id`, and no code reads it.

### Runtime path

```
a Claude call -> a part with an id -> chatState -> the snapshot of a late client
a compaction -> chat/responsePart with an id -> every client
```

### Gaps

- Two kinds of part carry a key the protocol does not declare.
- The wire suite does not read the chat after its turn.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A tool call part holds `kind` and `toolCall`, and the map of open parts keeps the call id as its key. | `ToolCallResponsePart` in npm://@microsoft/agent-host-protocol@1.0.0 | 01 |
| A compaction notice holds `kind` and `content`. | `SystemNotificationResponsePart`, and the round notice, [code://packages/agent-claude/src/session/stream.ts#L150-L165](../../../../packages/agent-claude/src/session/stream.ts#L150-L165) | 01 |
| The wire suite asks for the chat again after its turn. | Its own comment, "the state a client connecting late reads: the turn that just ended", [code://packages/sdk/test/wire.test.ts#L449-L452](../../../../packages/sdk/test/wire.test.ts#L449-L452) | 01 |
| The `_meta` census lists `toolKind` on the call in a snapshot. | "The same hint is on the call in a snapshot", [code://docs/sdk/AHP.md#L266](../../../../docs/sdk/AHP.md#L266) | 01 |

## Proposed architecture

- **Data flow** - a Claude part is the protocol's part, live and restored.
- **Event flow** - no change.
- **State flow** - no change.
- **Layer responsibilities** - `@ahpd/agent-claude`: its parts; `@ahpd/sdk` tests: the wire suite and a case through the host.
- **Source-of-truth files** - [`code://packages/agent-claude/src/session/stream.ts`](../../../../packages/agent-claude/src/session/stream.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A Claude part is the protocol's](task-01-a-claude-part-is-the-protocols.md) | done | - |

## Risks and tradeoffs

- none.

## Resume state

- **Done so far:** planned and built 2026-10-27; see [implemented.md](implemented.md).
- **Next action:** none.
- **Open questions:** none.
- **Watch out for:** each of the five places makes its own part, so a case must reach all five.

## Final verification checklist

- [x] The new cases fail on the session before this change.
- [x] `plans/index.md` updated.
