---
title: An ACP session sends what the protocol declares
domain: host
status: planned
priority: high
created: 2026-10-27
revalidated: 2026-10-27
requires:
  - plans/host/127-every-agent-sends-what-the-protocol-declares/plan.md
  - plans/host/127-p1-the-host-describes-every-agent/plan.md
refs:
  - "[code://packages/agent-acp/src/mapping.ts#L32-L33](../../../../packages/agent-acp/src/mapping.ts#L32-L33) - `partOf`, which finds a part by an `id` of its own"
  - "[code://packages/agent-acp/src/mapping.ts#L96-L135](../../../../packages/agent-acp/src/mapping.ts#L96-L135) - `callOf`, which makes a tool call part with an `id`"
  - "[code://packages/agent-acp/src/mapping.ts#L184-L196](../../../../packages/agent-acp/src/mapping.ts#L184-L196) - `ready`, which sends the call's line and its confirmation and keeps neither"
  - "[code://packages/agent-acp/src/mapping.ts#L284-L322](../../../../packages/agent-acp/src/mapping.ts#L284-L322) - `closed` and `shown`, which keep part of what they send"
  - "[code://packages/agent-acp/src/mapping.ts#L466-L474](../../../../packages/agent-acp/src/mapping.ts#L466-L474) - \"the session's snapshot is built from the turn's own parts\", so a part is changed as its action is sent"
  - "[code://packages/agent-acp/src/session/handlers.ts#L104-L112](../../../../packages/agent-acp/src/session/handlers.ts#L104-L112) - `commandLeaf`, a server command as a prompt"
  - "[code://packages/agent-acp/src/session/handlers.ts#L242-L243](../../../../packages/agent-acp/src/session/handlers.ts#L242-L243) - the commands, sent as top-level customizations"
  - "[code://packages/agent-acp/src/session/handlers.ts#L546](../../../../packages/agent-acp/src/session/handlers.ts#L546) - a permission's call, found by a part `id`"
  - "[code://packages/agent-acp/src/session/queue.ts#L70](../../../../packages/agent-acp/src/session/queue.ts#L70) - the part of a person's shell command, made with an `id`"
  - "[code://packages/agent-claude/src/session/customizations.ts#L74-L85](../../../../packages/agent-claude/src/session/customizations.ts#L74-L85) - Claude's own commands, the children of a directory"
  - https://github.com/microsoft/agent-host-protocol/blob/362bf618bba1ecc8b56b3ee64aaf31c55050c0ec/docs/guide/customizations.md - a prompt is a child of a container, and a top-level entry is a container or an MCP server
---

## Goal

An ACP session sends three things the protocol does not declare, and keeps a call that differs from the call it sent.
Each tool call part carries an `id`, and the server's commands are top-level prompts, which the protocol only allows inside a container.
A reported call's snapshot lacks the line and the confirmation its ready sent, and keeps content its completion dropped.
With this plan, an ACP session sends only what the protocol declares, and its snapshot holds the calls a watching client built.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- The case drives a reported call, a call asked about first and a shell command through `createHost`.
- It reports `responseParts/N undeclared key id` three times, and `SessionCustomizationsChangedAction /customizations/N` with a type not in the union.
- It reports a completed call with no `invocationMessage` and no `confirmed`, which is the reported call.
- The protocol's reducer builds a completed call from the running one and the result, and drops what the call showed while it ran.
- `rg -n "one.id === toolCallId" packages/agent-acp/src` - two lookups of a call by a part `id`.

### Runtime path

```
a session update -> mapUpdate -> a part, and actions -> the snapshot, and the reducer of a watching client
available_commands_update -> commandLeaf -> session/customizationsChanged
```

### Gaps

- A tool call part carries an `id`, and the agent's lookups depend on it.
- The commands are prompts at the top level of the tree.
- The record of a call misses what its ready said, and keeps what its completion dropped.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A tool call part holds `kind` and `toolCall`, and `callPartOf` finds it by the call's own id. | `ToolCallResponsePart` in npm://@microsoft/agent-host-protocol@1.0.0 | 01 |
| A ready, a content change and a completion put their fields onto the held call from the object they send. | [code://packages/agent-claude/src/session/stream.ts#L573-L583](../../../../packages/agent-claude/src/session/stream.ts#L573-L583) | 01 |
| A completion drops the content the call showed while it ran, and a content change moves only a running call. | The chat reducer's `ChatToolCallComplete` and `ChatToolCallContentChanged` in npm://@microsoft/agent-host-protocol@1.0.0 | 01 |
| The server's commands are the children of one read-only directory, under `acp-command:<provider>`. | The customization guide, and Claude's commands, [code://packages/agent-claude/src/session/customizations.ts#L74-L85](../../../../packages/agent-claude/src/session/customizations.ts#L74-L85) | 01 |

## Proposed architecture

- **Data flow** - each part the session holds is the protocol's part, with the fields its actions sent.
- **Event flow** - no change.
- **State flow** - a held call follows the reducer.
- **Layer responsibilities** - `@ahpd/agent-acp`: its parts and its customizations.
- **Source-of-truth files** - [`code://packages/agent-acp/src/mapping.ts`](../../../../packages/agent-acp/src/mapping.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - An ACP part is the protocol's](task-01-an-acp-part-is-the-protocols.md) | done | - |

## Risks and tradeoffs

- The directory's URI names no folder on disk; the commands are the server's, and `writable` is false.

## Resume state

- **Done so far:** planned and built 2026-10-27; see [implemented.md](implemented.md).
- **Next action:** none.
- **Open questions:** none.
- **Watch out for:** the case needs a client message with its `origin`, or it reports the client's message.

## Final verification checklist

- [x] The new case fails on the session before this change.
- [x] `plans/index.md` updated.
