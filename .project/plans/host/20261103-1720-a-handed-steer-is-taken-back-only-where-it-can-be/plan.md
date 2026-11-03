---
title: A handed steer is taken back only where it can be
domain: host
status: planned
priority: high
created: 2026-11-03
revalidated: 2026-11-03
refs:
  - git://3945964a - the commit of ahpd this plan was checked at
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L13517-L13524 - steering handed to the provider can be removed only if the provider can withdraw it, checked before the provider hears of it"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/AGENTS.md?plain=1#L617 - a client may remove handed-off steering during a turn only when the provider implements `withdrawSteeringMessage`"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/claude/claudeAgent.ts#L2477-L2501 - the Claude agent hands steering on and has no withdraw"
  - "[code://packages/sdk/src/host/chatactions.ts#L1464-L1467](../../../../packages/sdk/src/host/chatactions.ts#L1464-L1467) - the host refuses steering to a backend with no `steer`, the same capability check"
  - "[code://packages/sdk/src/host/chatactions.ts#L1781-L1815](../../../../packages/sdk/src/host/chatactions.ts#L1781-L1815) - the removal: `unqueue`, then a refusal during a turn when the backend said nothing"
  - "[code://packages/agent-claude/src/session/turns.ts#L904-L931](../../../../packages/agent-claude/src/session/turns.ts#L904-L931) - Claude's `unqueue`, which drops a steer its CLI was handed"
  - "[code://packages/agent-cofold/src/turns.ts#L913-L947](../../../../packages/agent-cofold/src/turns.ts#L913-L947) - cofold's `unqueue`, which marks a steer its run holds as withdrawn"
  - "[code://packages/sdk/src/sessions/nested.ts#L1603-L1607](../../../../packages/sdk/src/sessions/nested.ts#L1603-L1607) - the proxy's `unqueue`, which carries a removal inside"
  - "git://feb72387 - .project/problems/a-backend-keeps-a-steer-the-client-took-back.md, the problem the withdraw in Claude and cofold answered, for a removal while no turn runs"
---

## Goal

A client's removal of the steering message while a turn runs is refused before the backend hears of it.
A backend that can take a handed steer back does it through `Session.withdraw`, and the removal is answered.
The host and every backend then agree on whether the steer runs.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `unqueue` and `withdraw` in `packages/*/src`: each backend's road for a removal.
- `withdrawSteeringMessage` in VS Code at `a4e689ae`: only Copilot implements it, and the Claude agent does not.
- The test cases that take a steering message back: host steering, cofold's turn cases, pi's steering cases and the nested proxy.

### What the sources say

- VS Code's host checks the provider's capability before applying the removal, and refuses it in fixed words.
- Its Claude agent has no withdraw, so a Claude steer's removal during a turn is refused there.
- The check covers the steering entry while a turn is active, whatever the provider holds.

### What ahpd does

- The host calls the backend's `unqueue` first, and refuses the removal afterwards when the backend said nothing during a turn.
- Claude's and cofold's `unqueue` drop a steer they were handed and say nothing, so the host refuses a removal they already made.
- Claude's CLI then never reads the steer, though every client still shows it.
- cofold suppresses the steer's removal once its run reads it, so every client keeps showing it after the turn.
- The withdraw in Claude and cofold came for a removal while no turn runs, which the host answers.

### Gaps

- The host and Claude or cofold disagree on whether a steer taken back during a turn runs.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A removal of the steering message while a turn runs is refused before the backend hears of it, unless the backend can withdraw | [agentService.ts#L13517-L13524](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L13517-L13524) | 01 |
| The capability is an optional `Session.withdraw`, as `steer` is the capability for steering | [chatactions.ts#L1464-L1467](../../../../packages/sdk/src/host/chatactions.ts#L1464-L1467), and VS Code's optional `withdrawSteeringMessage` | 01 |
| Claude, cofold and pi have no `withdraw`; the bot takes each steer out as it hands it on | [claudeAgent.ts#L2477-L2501](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/claude/claudeAgent.ts#L2477-L2501); cofold's `RunHandle.submit` and pi's `AgentSession` give no single steer back | 01 |
| The proxy's `withdraw` carries the removal inside, whose host decides | the one-producer relay of the nested proxy | 01 |
| A removal while no turn runs keeps going to `unqueue`, which takes back what the backend can | the problem `a-backend-keeps-a-steer-the-client-took-back` | 01 |

## Proposed architecture

- **Data flow** - the host's removal case checks the running turn and `withdraw` before it calls the backend.
- **Layer responsibilities** - sdk: the check, `Session.withdraw`, the proxy's `withdraw`. agent-claude, agent-cofold: what their `unqueue` says it reaches.
- **Source-of-truth files** - [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts), [`code://packages/sdk/src/types/session.ts`](../../../../packages/sdk/src/types/session.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The host asks for withdraw before it asks the backend](task-01-the-host-asks-for-withdraw-before-it-asks-the-backend.md) | todo | - |

## Risks and tradeoffs

- A steering message waiting in a backend's queue while a turn runs can no longer be taken back, as in VS Code's host.

## Resume state

- **Done so far:** nothing yet.
- **Next action:** task 01.
- **Open questions:** none.
- **Watch out for:** the nested proxy, whose removal the host inside answers.

## Final verification checklist

- [ ] Each new or changed case fails on `3945964a`'s sources and passes after the change.
- [ ] The test files that hold the cases pass, one file at a time.
- [ ] `pnpm run typecheck` and `pnpm run boundary` report no errors, and the prose lint is clean.
