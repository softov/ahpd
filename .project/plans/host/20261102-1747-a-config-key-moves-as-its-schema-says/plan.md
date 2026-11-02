---
title: A config key moves as its schema says
domain: host
status: active
priority: high
created: 2026-11-02
revalidated: 2026-11-02
refs:
  - git://89ebe4d5 - the commit of ahpd this plan was checked at
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-session/actions.ts#L604-L608 - the specification's text: only a property with `sessionMutable: true` may be changed"
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-session/state.ts#L622-L623 - `sessionMutable`: when `true`, the user may change the property after the session is created"
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/actions.ts#L724-L743 - a truncation, which says nothing of a backend that cannot cut"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L13563-L13606 - the reference host takes a session config change without reading `sessionMutable`, and refuses only the keys it writes itself"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/common/sessionConfigProperties.ts#L131-L133 - its clients write a running session's key only when the schema says `sessionMutable` or `chatMutable`"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/common/sessionConfigProperties.ts#L159-L165 - and send a new session only the keys its schema declares"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/sessions/contrib/providers/agentHost/browser/baseAgentHostSessionsProvider.ts#L6607-L6611 - the Sessions window refuses itself a write the schema does not allow"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/sessions/contrib/providers/agentHost/browser/baseAgentHostSessionsProvider.ts#L3986-L3999 - its new session's config, filtered by the schema"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostSessionHandler.ts#L2273-L2286 - the workbench's chat sends a session's picks before each turn"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostSessionHandler.ts#L6985-L7003 - and filters a new session's config by the schema"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSideEffects.ts#L2228-L2235 - a turn's model goes to its chat's agent"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/claude/claudeAgent.ts#L2503-L2521 - the reference Claude records the chat's model and sets it on the running session"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/claude/claudeAgentSession.ts#L1206-L1226 - the model's effort goes to the SDK, and no config action is said"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L13642-L13668 - a client's config change is said, then handed to the agent"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSideEffects.ts#L1968-L2005 - a truncation is held, then handed to the agent, and a cut that fails is logged"
  - "[code://packages/sdk/src/host/chatactions.ts#L958-L1025](../../../../packages/sdk/src/host/chatactions.ts#L958-L1025) - the fixed keys, and the keys the backend is asked about"
  - "[code://packages/sdk/src/host/sessionconfig.ts#L308-L334](../../../../packages/sdk/src/host/sessionconfig.ts#L308-L334) - `propertyOf`, what the host reads of a key's schema"
  - "[code://packages/agent-claude/src/session/config.ts#L86-L124](../../../../packages/agent-claude/src/session/config.ts#L86-L124) - `permissionFor`, two keys the schema does not declare mapped onto `permissionMode`"
  - "[code://packages/agent-claude/src/session/turns.ts#L286-L300](../../../../packages/agent-claude/src/session/turns.ts#L286-L300) - a turn's thinking level written into the session's config"
  - "[code://packages/agent-pi/src/session.ts#L956-L966](../../../../packages/agent-pi/src/session.ts#L956-L966) - a cut pi refuses fails the open"
  - "[code://packages/agent-cofold/src/session.ts#L451-L456](../../../../packages/agent-cofold/src/session.ts#L451-L456) - cofold takes any key its schema declares"
  - "[code://packages/sdk/src/sessions/nested.ts#L1489-L1495](../../../../packages/sdk/src/sessions/nested.ts#L1489-L1495) - the nested proxy refuses a key the inner schema marks `sessionMutable: false`"
  - "[code://packages/agent-pi/src/session.ts#L1629-L1643](../../../../packages/agent-pi/src/session.ts#L1629-L1643) - pi takes its two keys"
---

## Goal

A session's config moves only where its schema lets it, and only by a client's change.
Once a chat of the session has a turn, a key the schema does not mark `sessionMutable: true` is refused.
Claude takes only the keys its schema declares.
A turn's thinking level moves the effort of that turn, and nothing in the session's config.
A cut that pi refuses is logged, and the session runs on.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "sessionMutable" packages/*/src` - the host refuses a moved key only when its schema says `sessionMutable: false`.
- A key whose schema says nothing of `sessionMutable` is asked of the backend on a running session.
- `rg -n "permissionFor|autoApprove" packages/agent-claude/src` - Claude maps `autoApprove` and `mode` onto `permissionMode`, and declares neither.
- `rg -n "effortLevel" packages/agent-claude/src` - a turn's `thinkingLevel` is written into the session's `effortLevel` and said by `session/configChanged`.
- `rg -n "rewind" packages/agent-pi/src` - a cut pi refuses throws from the open, which fails the turn.
- VS Code main at `a4e689ae`: its host reads no `sessionMutable` on a change, and its clients send none that the schema forbids.

### Runtime path

```
session/configChanged -> chatactions.ts -> a fixed key restarts the backend, or is refused once the session has started
  -> any other key -> the backend's setConfig -> the session's config, said to every client
chat/turnStarted -> Claude's begin -> the turn's model and its thinking level -> the CLI
chat/truncated -> the host's held state -> pi's next open -> pi's rewind
```

### Gaps

- A key whose schema says nothing of `sessionMutable` moves on a running session.
- Claude takes two keys its schema does not declare.
- A turn's thinking level moves the session's effort control for every client.
- A cut pi refuses fails the next turn, where the reference host logs it and runs on.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A9: once a chat of the session has a turn, a key its schema declares without `sessionMutable: true` is refused, "<key> is fixed once the session has started" | [actions.ts#L604-L608](https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-session/actions.ts#L604-L608); [state.ts#L622-L623](https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-session/state.ts#L622-L623) | 01 |
| A9: a VS Code client never sends such a change, so it cannot tell, and the specification's text holds | [sessionConfigProperties.ts#L131-L133](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/common/sessionConfigProperties.ts#L131-L133); [baseAgentHostSessionsProvider.ts#L6607-L6611](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/sessions/contrib/providers/agentHost/browser/baseAgentHostSessionsProvider.ts#L6607-L6611) | 01 |
| A9: before the first turn such a key starts the backend again with the new value, as a `sessionMutable: false` key does | [code://packages/sdk/src/host/chatactions.ts#L958-L975](../../../../packages/sdk/src/host/chatactions.ts#L958-L975); [agentHostSessionHandler.ts#L2273-L2286](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostSessionHandler.ts#L2273-L2286) | 01 |
| F7, X10, pi R35: cofold, the nested proxy and pi keep their own checks; the host's refusal comes before each | [code://packages/agent-cofold/src/session.ts#L451-L456](../../../../packages/agent-cofold/src/session.ts#L451-L456); [code://packages/sdk/src/sessions/nested.ts#L1489-L1495](../../../../packages/sdk/src/sessions/nested.ts#L1489-L1495) | 01 |
| E14: Claude refuses `autoApprove` and `mode` as keys its schema does not declare, and `permissionFor` goes | [actions.ts#L604-L608](https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-session/actions.ts#L604-L608); [sessionConfigProperties.ts#L159-L165](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/common/sessionConfigProperties.ts#L159-L165) | 02 |
| E14: a VS Code client sends neither key to a host whose schema does not declare it, so the specification's text holds | [baseAgentHostSessionsProvider.ts#L3986-L3999](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/sessions/contrib/providers/agentHost/browser/baseAgentHostSessionsProvider.ts#L3986-L3999); [agentHostSessionHandler.ts#L6985-L7003](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostSessionHandler.ts#L6985-L7003) | 02 |
| CT2: a turn's thinking level sets the CLI's effort for that turn, no `session/configChanged` is said, and a later turn without one goes back to the session's `effortLevel` | [agentSideEffects.ts#L2228-L2235](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSideEffects.ts#L2228-L2235); [claudeAgentSession.ts#L1206-L1226](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/claude/claudeAgentSession.ts#L1206-L1226) | 03 |
| CT8: no change; a change is answered before the SDK takes it, as the reference host says a change and then hands it to the agent | [agentService.ts#L13642-L13668](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L13642-L13668) | - |
| P11: the cut is said before pi takes it, as the reference host holds it before the agent cuts | [agentSideEffects.ts#L1968-L2005](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSideEffects.ts#L1968-L2005) | - |
| P11: a cut pi refuses is logged, and the turn runs on pi's current leaf, as the reference host logs a failed `truncateChat` | [agentSideEffects.ts#L1982-L1986](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSideEffects.ts#L1982-L1986); [chat actions.ts#L724-L743](https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/actions.ts#L724-L743) | 04 |

## Proposed architecture

- **State flow** - a session's config moves only by a client's change the schema allows, and by a backend's own report.
- **Layer responsibilities** - sdk: the host reads `sessionMutable` for every declared key · agent-claude: it takes the keys its schema declares · agent-pi: it logs a refused cut.
- **Source-of-truth files** - [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts), [`code://packages/agent-claude/src/session/config.ts`](../../../../packages/agent-claude/src/session/config.ts), [`code://packages/agent-claude/src/session/turns.ts`](../../../../packages/agent-claude/src/session/turns.ts), [`code://packages/agent-pi/src/session.ts`](../../../../packages/agent-pi/src/session.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A key the schema does not mark mutable is fixed](task-01-a-key-not-marked-mutable-is-fixed.md) | done | - |
| [02 - Claude takes only the keys it declares](task-02-claude-takes-only-declared-keys.md) | todo | - |
| [03 - A turn's thinking level moves no session config](task-03-a-turns-level-moves-no-config.md) | todo | - |
| [04 - A cut pi refuses is logged](task-04-a-cut-pi-refuses-is-logged.md) | todo | - |

## Risks and tradeoffs

- A plugin key declared without `sessionMutable` stops moving on a running session; the schema says it may not.
- A client that sends `autoApprove` or `mode` to a Claude session hears a refusal; `permissionMode` is the key Claude declares.
- After a cut pi refuses, the agent answers from turns the client no longer shows, as the reference host's agent does.

## Resume state

- **Done so far:** task 01, 2026-11-02.
- **Next action:** [task-02-claude-takes-only-declared-keys.md](task-02-claude-takes-only-declared-keys.md).
- **Open questions:** none.
- **Watch out for:** a key this host owns, such as `isolation`, keeps its own rule in `ours`.

## Final verification checklist

- [ ] Each new case fails on `89ebe4d5` for the reason it names, and passes after the change.
- [ ] The touched test files pass.
- [ ] `pnpm run typecheck` and `pnpm run boundary` report no errors, and the prose lint is clean.
