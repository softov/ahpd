---
title: A turn ends as VS Code ends it
domain: host
status: built
priority: high
created: 2026-11-02
revalidated: 2026-11-02
refs:
  - git://89ebe4d5 - the commit of ahpd this plan was checked at
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/actions.ts#L497 - a turn's ending carries its `duration`"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/stateToProgressAdapter.ts#L1343-L1346 - VS Code's chat draws a turn's elapsed time from its `duration`"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSideEffects.ts#L1854-L1860 - a failed send ends its turn with `chat/error`"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSideEffects.ts#L1921-L1956 - a stop ends the turn and aborts the agent"
  - "[code://packages/sdk/src/sessions/nested.ts#L568-L615](../../../../packages/sdk/src/sessions/nested.ts#L568-L615) - the nested proxy ends a failed turn with a duration of 0"
  - "[code://packages/bot/src/plugin.ts#L583-L608](../../../../packages/bot/src/plugin.ts#L583-L608) - a back session's turn end, read whatever its status"
  - "[code://packages/bot/src/wake.ts#L483-L502](../../../../packages/bot/src/wake.ts#L483-L502) - `finished`, which replies, notices or ends"
---

## Goal

A turn ends in every client's state as VS Code's host ends it.
A turn the nested proxy fails says how long it ran.
A bot's turn whose back session failed ends as failed, in the failure's words.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "duration: 0" packages/sdk/src/sessions/nested.ts` - a failed or halted inner host ends the outer turn with a duration of 0.
- `rg -n "turn_end|finished" packages/bot/src` - a back session's turn that failed ends the bot's turn as complete.
- `rg -n "cancel:" packages/agent-pi/src packages/agent-acp/src packages/sdk/src/sessions/nested.ts` - pi aborts, ACP cancels, and the proxy carries a stop inside.
- VS Code main at `a4e689ae`: its chat draws a turn's `duration`, and a failed send ends with `chat/error`.

### Runtime path

```
the inner host fails -> nested.ts fail or halt -> chat/error with the turn's duration
a back session's turn ends in error -> turn_end -> wake.finished -> the main turn's fail -> chat/error
```

### Gaps

- A nested turn that failed reads as having run for no time.
- A bot's turn reads complete when the work behind it failed.

## Answers

| What | Source | Task |
| --- | --- | --- |
| X6: the nested proxy ends a failed turn with the time it ran | [stateToProgressAdapter.ts#L1343-L1346](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/stateToProgressAdapter.ts#L1343-L1346); [actions.ts#L497](https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/actions.ts#L497) | 01 |
| B7: a bot's turn whose back session's turn failed ends with `chat/error`, in that turn's words | [agentSideEffects.ts#L1854-L1860](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSideEffects.ts#L1854-L1860) | 02 |
| P1: fixed by `host/20261101-1556-every-backend-says-its-state-by-actions`, in main | [code://packages/agent-pi/src/session.ts](../../../../packages/agent-pi/src/session.ts) | - |
| P5, Q28, X22: no change; pi aborts its agent, ACP cancels its session, and the proxy carries the stop inside, as the reference host aborts on a stop | [agentSideEffects.ts#L1921-L1956](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSideEffects.ts#L1921-L1956) | - |
| B5: a stop of a bot's turn stops the back session's running turn, with the time the bot timed it or zero, and the back session answers that turn no more | [agentSideEffects.ts#L1942](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSideEffects.ts#L1942); [agentSideEffects.ts#L1470-L1483](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSideEffects.ts#L1470-L1483) | 03 |
| B5: the bot's back session is the reference host's subagent session, the work a stopped turn waited on, so the reference host's cancel of a subagent's running turn is the rule | [agentSideEffects.ts#L1470-L1483](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSideEffects.ts#L1470-L1483) | 03 |
| B5: the bot cancels as a client, and a client's `duration` is its own stopwatch's, zero for a turn it never timed | [agentHostSessionHandler.ts#L2030-L2035](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostSessionHandler.ts#L2030-L2035) | 03 |
| E32, X5, Q15: open; the reference host says `session/ready` once its agent's session is live, at creation or at a provisional session's first message, and these backends start theirs at the first turn | [agentService.ts#L6475-L6477](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L6475-L6477); [agentService.ts#L10826-L10828](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L10826-L10828) | - |
| Q18, Q19, CS5, CS4: left as they are; VS Code's host was not read for them in this plan | `(defaulted: each stays as it is)` | - |

## Proposed architecture

- **Event flow** - a failed turn ends with `chat/error` and the time it ran, from whichever backend failed it.
- **Layer responsibilities** - sdk: the nested proxy's durations · bot: a failed back session's turn.
- **Source-of-truth files** - [`code://packages/sdk/src/sessions/nested.ts`](../../../../packages/sdk/src/sessions/nested.ts), [`code://packages/bot/src/chat.ts`](../../../../packages/bot/src/chat.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A nested turn says how long it ran](task-01-a-nested-turn-says-how-long-it-ran.md) | done | - |
| [02 - A bot's failed turn ends as failed](task-02-a-bots-failed-turn-ends-as-failed.md) | done | - |
| [03 - A bot's stop stops its back session](task-03-a-bots-stop-stops-its-back-session.md) | done | - |

## Risks and tradeoffs

- A bot's failed turn shows the back session's sentence, which may name things of that session.

## Resume state

- **Done so far:** tasks 01 to 03, 2026-11-02.
- **Next action:** none; see [implemented.md](implemented.md).
- **Open questions:** none.
- **Watch out for:** a halt ends the outer turn too, so both endings take the turn's start.

## Final verification checklist

- [x] Each new case fails on `89ebe4d5` for the reason it names, and passes after the change.
- [x] The touched test files pass.
- [x] `pnpm run typecheck` and `pnpm run boundary` report no errors, and the prose lint is clean.
