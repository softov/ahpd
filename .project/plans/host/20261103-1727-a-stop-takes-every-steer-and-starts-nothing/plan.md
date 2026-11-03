---
title: A stop takes every steer and starts nothing
domain: host
status: planned
priority: high
created: 2026-11-03
revalidated: 2026-11-03
refs:
  - git://3945964a - the commit of ahpd this plan was checked at
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L55-L69 - at a cancel the host takes every pending steering entry out with its own action, and drains nothing"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L71-L90 - a client's removal, once applied, runs the drain"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/AGENTS.md?plain=1#L617 - cancellation clears every pending steering entry, including prompts handed off but not yet consumed by the SDK, without draining queued follow-ups"
  - "[code://packages/sdk/src/host.ts#L1111-L1126](../../../../packages/sdk/src/host.ts#L1111-L1126) - the stop's cleanup, which takes the client's road with the backend's `unqueue` for the one steering message the chat shows"
  - "[code://packages/agent-claude/src/session/turns.ts#L904-L931](../../../../packages/agent-claude/src/session/turns.ts#L904-L931) - Claude's `unqueue`, which starts the queue"
  - "[code://packages/agent-claude/src/session/query.ts#L1043-L1048](../../../../packages/agent-claude/src/session/query.ts#L1043-L1048) - the stopped prompt's result, which starts a start a take-back deferred"
  - "[code://packages/agent-cofold/src/turns.ts#L617-L654](../../../../packages/agent-cofold/src/turns.ts#L617-L654) - cofold's `startNext`, which hands the head at once while a stopped run winds down"
  - "[code://packages/agent-pi/src/session.ts#L1704-L1712](../../../../packages/agent-pi/src/session.ts#L1704-L1712) - pi's `unqueue`, which marks a change after a stop and starts the queue"
  - "[code://packages/bot/src/chat.ts#L1143-L1150](../../../../packages/bot/src/chat.ts#L1143-L1150) - the bot's `unqueue`, which starts the queue"
---

## Goal

A turn that ends cancelled takes every steering message its chat holds with it, handed to the agent or waiting.
Nothing starts behind it.
The backend lets go of what it holds, and says each one gone.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `unqueue`, `steer`, `queued` and `steering` in `packages/agent-*/src`, `packages/bot/src` and `packages/sdk/src/sessions/nested.ts`.
- Where each backend keeps steering: Claude's `queued`, `owed` and `waiting`; cofold's submits, `untaken` and `queued`; pi's runtime and `queued`; the bot's `waiting`.
- `startNext` and `deferred` at each backend's take-back and wind-down.

### What the sources say

- VS Code's host removes every pending steering entry with its own action when a turn ends cancelled.
- That action runs no drain, which only a client's removal and a success run.
- Its AGENTS.md says the clear covers prompts handed off and not yet consumed, and drains no queued follow-up.

### What ahpd does

- At a cancelled end the host calls the backend's `unqueue` for the one steering message the chat shows.
- `unqueue` is the client's road, and every backend's starts the head of the queue.
- Claude's start waits for the stopped prompt's answer and then runs; cofold's hands the head at once in the wind-down.
- pi marks the take-back as a client's change, and its wind-down hands the head; the bot starts the head.
- The backends keep more steering than the one the chat shows: Claude's and pi's queue, cofold's handed-back steers and those its run holds.
- Those stay, and run as turns of their own after the stop.
- A nested session's cleanup goes inside as a client's removal, beside the host inside's own cleanup.

### Gaps

- A stop starts the next queued message in narrow windows.
- A stop leaves every steering message but the shown one, and they run later.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A cancelled end clears every pending steering entry, handed or waiting | [queueDrainContribution.ts#L55-L69](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L55-L69); [AGENTS.md#L617](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/AGENTS.md?plain=1#L617) | 01 |
| The clear starts nothing, and is no client's removal | [queueDrainContribution.ts#L71-L90](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L71-L90) | 01 |
| The backend, which holds the steering, lets go of it through an optional `Session.clearSteering` | the queue is the session's in ahpd, and the host's chat state holds one steering message | 01 |
| A steering message the agent has taken in is not pending, and is the agent's | "not yet consumed by the SDK", AGENTS.md L617 | 01 |
| A nested session's steering is the host inside's to clear | the one-producer relay of the nested proxy | 01 |
| A backend without `clearSteering` has the shown steering message taken out by the host, with no take-back | the host's own removal at a cancel in VS Code | 01 |

## Proposed architecture

- **State flow** - the host's cancelled-end hook calls `clearSteering`, or takes the shown steering message out itself.
- **Layer responsibilities** - sdk: the hook, `Session.clearSteering`, the proxy's. Claude, cofold, pi, the bot: their `clearSteering`.
- **Source-of-truth files** - [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts), [`code://packages/sdk/src/types/session.ts`](../../../../packages/sdk/src/types/session.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The backend lets go of every steer at a stop](task-01-the-backend-lets-go-of-every-steer-at-a-stop.md) | todo | - |

## Risks and tradeoffs

- Claude's CLI runs a steering message it has read after the stop, and the session opens a turn for it.
- VS Code's Claude agent aborts its query at a cancel, so such a message runs nowhere there; this plan leaves that road as it is.

## Resume state

- **Done so far:** nothing yet.
- **Next action:** task 01.
- **Open questions:** none.
- **Watch out for:** cofold's submits, which settle after the stop and must stay silent.

## Final verification checklist

- [ ] Each new case fails on `3945964a`'s sources and passes after the change.
- [ ] The test files that hold the cases pass, one file at a time.
- [ ] `pnpm run typecheck` and `pnpm run boundary` report no errors, and the prose lint is clean.
