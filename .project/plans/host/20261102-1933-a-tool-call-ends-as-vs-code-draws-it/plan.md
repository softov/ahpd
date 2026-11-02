---
title: A tool call ends as VS Code draws it
domain: host
status: built
priority: high
created: 2026-11-02
revalidated: 2026-11-02
refs:
  - git://89ebe4d5 - the commit of ahpd this plan was checked at
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/reducer.ts#L172-L211 - a turn's end forces each unfinished call to cancelled, `skipped`"
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/actions.ts#L283 - a refusal's reason is `denied` or `skipped`"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/stateToProgressAdapter.ts#L548 - VS Code's chat draws any reason but `skipped` as denied"
  - "[code://packages/bot/src/chat.ts#L694-L713](../../../../packages/bot/src/chat.ts#L694-L713) - the bot completes every call of a turn as worked"
  - "[code://packages/agent-pi/src/session.ts#L360-L387](../../../../packages/agent-pi/src/session.ts#L360-L387) - pi denies each waiting call at a stop, in no client's name"
  - "[code://packages/agent-cofold/src/pauses.ts#L225-L232](../../../../packages/agent-cofold/src/pauses.ts#L225-L232) - cofold says a refusal with its sentence for a reason"
---

## Goal

A tool call ends in every client's state the way VS Code's chat would draw it.
A call its turn left unfinished ends cancelled, `skipped`, and nothing is said of it in anybody's name.
A refusal is said as `denied`, the protocol's word for it.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "toolCallComplete|success: true" packages/bot/src/chat.ts` - the bot ends every call of a turn as worked, whatever ended the turn.
- `rg -n "releasePending" packages/agent-pi/src/session.ts` - pi says a denial for each waiting call at a stop.
- `rg -n "DECLINED" packages/agent-cofold/src` - cofold's refusal carries a sentence where the protocol has `denied`.
- VS Code main at `a4e689ae`: its chat draws a call's reason, `skipped` as skipped and any other as denied.

### Runtime path

```
a turn's end -> the reducer -> each unfinished call cancelled, skipped -> the chat drawn
chat/toolCallConfirmed approved false -> the backend -> the refusal said back with its reason
```

### Gaps

- A bot's call reads as worked when its turn was stopped or failed.
- pi's waiting calls read as denied by a person when a stop left them.
- cofold's refusal carries a reason no client knows.

## Answers

| What | Source | Task |
| --- | --- | --- |
| B6: the bot completes its calls as worked only when the back session answered; otherwise the turn's end makes each cancelled, `skipped` | [reducer.ts#L172-L211](https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/reducer.ts#L172-L211); [stateToProgressAdapter.ts#L548](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/stateToProgressAdapter.ts#L548) | 01 |
| P6: pi says no confirmation at a stop, and its waiting calls end cancelled, `skipped` | [reducer.ts#L172-L211](https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/reducer.ts#L172-L211) | 01 |
| F5: cofold says a refusal as `denied`, and its sentence goes to the model alone | [actions.ts#L283](https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/actions.ts#L283) | 02 |
| CS1, CT7: fixed by `host/20261101-1556-every-backend-says-its-state-by-actions`, in main | [code://packages/agent-claude/src/session/stream.ts](../../../../packages/agent-claude/src/session/stream.ts) | - |
| Q5: fixed by `host/20261102-0618-every-dispatch-is-answered-once-by-its-own-action`, in main; the echo is the client's own refusal | [code://packages/sdk/src/host/spawn.ts](../../../../packages/sdk/src/host/spawn.ts) | - |
| P10: no change; the reducer drops a completion of a cancelled call in every client | [reducer.ts#L631-L635](https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/reducer.ts#L631-L635) | - |
| CS3: no change; the host gives Claude its worker seam, so a worker's frames reach its own chat | [code://packages/agent-claude/src/session/workers.ts#L230-L240](../../../../packages/agent-claude/src/session/workers.ts#L230-L240) | - |
| Q21: open; VS Code's chat draws a call's `pastTenseMessage`, and VS Code runs no ACP agent whose words to compare | [stateToProgressAdapter.ts#L2266](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/stateToProgressAdapter.ts#L2266) | - |
| CS10, CS16, CS17, CS19, F15, F10, Q13, Q22, X8, B1, CS2: left as they are; VS Code's host was not read for them in this plan | `(defaulted: each stays as it is)` | - |

## Proposed architecture

- **State flow** - a backend's record of a call ends as the reducer ends it in every client.
- **Layer responsibilities** - bot: its link calls · agent-pi: a stop's waiting calls · agent-cofold: a refusal's reason.
- **Source-of-truth files** - [`code://packages/bot/src/chat.ts`](../../../../packages/bot/src/chat.ts), [`code://packages/agent-pi/src/session.ts`](../../../../packages/agent-pi/src/session.ts), [`code://packages/agent-cofold/src/pauses.ts`](../../../../packages/agent-cofold/src/pauses.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A call its turn left ends skipped](task-01-a-call-its-turn-left-ends-skipped.md) | done | - |
| [02 - A refusal is said as denied](task-02-a-refusal-is-said-as-denied.md) | done | - |

## Risks and tradeoffs

- A bot's skipped call loses its link to the back session's chat, as the reducer keeps no content on a cancelled call.

## Resume state

- **Done so far:** tasks 01 and 02, 2026-11-02.
- **Next action:** none; see [implemented.md](implemented.md).
- **Open questions:** none.
- **Watch out for:** a backend's own record of a cancelled call keeps what the reducer keeps, so a read back matches.

## Final verification checklist

- [x] Each new case fails on `89ebe4d5` for the reason it names, and passes after the change.
- [x] The touched test files pass.
- [x] `pnpm run typecheck` and `pnpm run boundary` report no errors, and the prose lint is clean.
