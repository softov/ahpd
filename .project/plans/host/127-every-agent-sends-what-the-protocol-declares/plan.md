---
title: Every agent sends what the protocol declares, and a late client reads what a watching one built
domain: host
status: built
priority: high
created: 2026-10-27
revalidated: 2026-10-27
requires:
  - plans/host/43-the-wire-is-the-protocols/plan.md
refs:
  - "[code://packages/sdk/test/wire.test.ts#L449-L452](../../../../packages/sdk/test/wire.test.ts#L449-L452) - the wire suite asks for the session again after its turn, and not for the chat"
  - "[code://packages/sdk/test/support/wire.ts](../../../../packages/sdk/test/support/wire.ts) - `undeclaredIn`, the protocol's own check over frames a host sends"
  - "[code://examples/notes/README.md#L160-L171](../../../../examples/notes/README.md#L160-L171) - \"What keeps it honest\": drive a backend through `createHost` and reduce every action it sent with the protocol's own reducers"
  - "[code://packages/sdk/src/host/spawn.ts#L201-L214](../../../../packages/sdk/src/host/spawn.ts#L201-L214) - `absorb`, which folds a worker chat with the protocol's own `chatReducer`"
  - "[code://packages/agent-claude/src/session/stream.ts#L573-L583](../../../../packages/agent-claude/src/session/stream.ts#L573-L583) - onto the call and into the action, from one object"
  - npm://@microsoft/agent-host-protocol@1.0.0 - `AgentInfo.description`, `ToolCallResponsePart`, `SystemNotificationResponsePart`, the customization tree, and the reducer that builds a completed call
---

## Goal

host 43 made every frame of a Claude session one that AHP declares, and its wire suite proves it.
Each other first-party agent is checked by nothing of the kind, and the wire suite never reads a chat after its turn.
Read through a real host with the protocol's own schema and reducer, every agent sends something the protocol does not declare.
A client that subscribes late also reads calls that differ from the calls a watching client built.
With this plan, every first-party agent sends only what the protocol declares, and a late client reads the calls a watching client built.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- For each agent, a case drives a turn with calls through `createHost` with a client message as the protocol declares one.
- The case checks every frame and a late subscription with `undeclaredIn`, and compares the late calls with the replayed actions.
- Claude: each tool call part carries an `id`, and so does a compaction notice.
- ACP: each tool call part carries an `id`, the agent has no `description`, and its commands are top-level prompts.
- ACP: a reported call's snapshot lacks what its ready said, and keeps content that its completion dropped.
- cofold: each tool call part carries an `id`, two notices carry one, and the agent has no `description`.
- pi: each tool call part carries an `id`, and a shell call and a completed call lack what their actions said.
- The bot: each tool call part carries an `id`.
- `rg -n "one.id === " packages/agent-*/src` - the agents find a tool call part by its `id`, which the protocol does not give it.

### Runtime path

```
a backend's record -> chatState -> the snapshot of a late client
a backend's actions -> the reducer of a watching client
```

### Gaps

- A part carries a key the protocol does not declare, and an agent entry lacks a required one.
- A backend's record and its actions say two things about one call.
- No suite reads a chat after its turn through the protocol's schema and reducer, except for Claude's stops.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Every first-party agent is driven through `createHost`, and its frames and a late subscription are checked with `undeclaredIn`. | host 43, and [code://packages/sdk/test/support/wire.ts](../../../../packages/sdk/test/support/wire.ts) | p1 to p6 |
| The calls a late client reads equal the calls the replayed actions build. | "What keeps it honest", [code://examples/notes/README.md#L160-L171](../../../../examples/notes/README.md#L160-L171) | p1 to p6 |
| A backend keeps its own record, and puts each action's fields onto it from the same object it sends. | [code://packages/agent-claude/src/session/stream.ts#L573-L583](../../../../packages/agent-claude/src/session/stream.ts#L573-L583) | p2 to p6 |
| A tool call part is found by the id of its call, not by an id of its own. | `ToolCallResponsePart` in npm://@microsoft/agent-host-protocol@1.0.0 | p2 to p6 |

## Proposed architecture

- **Data flow** - each part a backend holds is the protocol's part, with the fields its actions sent.
- **Event flow** - no change.
- **State flow** - a backend's record of a call follows the reducer: a ready, a content change while running, a completion.
- **Layer responsibilities** - `@ahpd/sdk`: the agent list, and the test support; each agent package: its own parts.
- **Source-of-truth files** - [`code://packages/sdk/test/support/replay.ts`](../../../../packages/sdk/test/support/replay.ts)

## Tasks

| Plan | Status | Depends on |
| --- | --- | --- |
| [p1 - The host describes every agent](../127-p1-the-host-describes-every-agent/plan.md) | built 2026-10-27 | - |
| [p2 - A Claude session sends what the protocol declares](../127-p2-a-claude-session-sends-what-the-protocol-declares/plan.md) | built 2026-10-27 | - |
| [p3 - An ACP session sends what the protocol declares](../127-p3-an-acp-session-sends-what-the-protocol-declares/plan.md) | built 2026-10-27 | p1 |
| [p4 - A cofold session sends what the protocol declares](../127-p4-a-cofold-session-sends-what-the-protocol-declares/plan.md) | built 2026-10-27 | p1 |
| [p5 - A pi session sends what the protocol declares](../127-p5-a-pi-session-sends-what-the-protocol-declares/plan.md) | built 2026-10-27 | - |
| [p6 - A bot chat sends what the protocol declares](../127-p6-a-bot-chat-sends-what-the-protocol-declares/plan.md) | built 2026-10-27 | - |

## Risks and tradeoffs

- A backend still keeps its own record beside its actions, so a later change can part the two again.
  The cases read every agent through the reducer, and they fail when the two part.

## Resume state

- **Done so far:** planned and built 2026-10-27; see [implemented.md](implemented.md).
- **Next action:** none.
- **Open questions:** none.
- **Watch out for:** a client message in a case must carry its `origin`, or the case reports the client and not the host.

## Final verification checklist

- [x] Each case fails on the code before this plan.
- [x] `pnpm boundary`, `pnpm typecheck` and `pnpm build` pass, and so do the suites of the packages this plan changes.
- [x] `plans/index.md` updated.
