---
title: The root counts the sessions with a turn running
domain: host
status: planned
priority: high
created: 2026-11-02
revalidated: 2026-11-02
refs:
  - git://6e6d1ca8 - the commit of ahpd this plan was checked at
  - "https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/agentHostStateManager.ts#L3250-L3262 - a chat whose state gains or loses its active turn moves its session's set of active chats"
  - "https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/agentHostStateManager.ts#L3162-L3188 - `root/activeSessionsChanged` says the number of sessions with an active turn, when a session flips"
  - "https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2368-L2377 - a session that goes while a turn runs leaves the count"
  - "https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/agentHostStateManager.ts#L1881-L1887 - a chat removed while its turn runs leaves its session's set"
  - "https://github.com/microsoft/vscode/blob/8fb60541db0e1a371ea40157e0f58951ae4a485d/src/vs/sessions/contrib/remoteSessions/browser/remoteSessionService.ts#L128 - the Sessions window shows the count as `runningSessions`"
  - "https://github.com/microsoft/vscode/blob/8fb60541db0e1a371ea40157e0f58951ae4a485d/src/vs/sessions/contrib/remoteSessions/browser/remoteSessionService.ts#L252-L255 - and ranks hosts by it when it places a remote session"
  - "https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/types/channels-root/state.ts#L39 - the specification's text: \"Number of active (non-disposed) sessions\""
  - "[code://packages/sdk/src/host/catalogue.ts#L484-L502](../../../../packages/sdk/src/host/catalogue.ts#L484-L502) - `activeCount` and `activeSessionsMoved`, which count every session held open"
  - "[code://packages/sdk/src/host/catalogue.ts#L1458-L1482](../../../../packages/sdk/src/host/catalogue.ts#L1458-L1482) - `chatMoved`, which runs after every chat action but a merged delta"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L1440-L1499](../../../../packages/sdk/src/host/sessionmethods.ts#L1440-L1499) - a chat closed"
  - "[code://.project/plans/host/20261101-0329-the-hosts-state-is-the-reducers-output/plan.md](../20261101-0329-the-hosts-state-is-the-reducers-output/plan.md) - the answer this plan reverses, which counts sessions held open"
---

## Goal

The root's `activeSessions` is the number of sessions with a turn running in any of their chats, as VS Code's host counts it.
A session counts from the moment one of its chats starts a turn until the last of its turns ends.
A session that is created, opened or woken with nothing running does not count, and a sleeping session does not count.
The number is said to the root's clients when it moves, and only then.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "activeCount|activeSessionsMoved|activeSessions" packages/*/src` - the root's seed and `activeSessionsMoved` read `activeCount`; nothing else reads the number.
- `activeSessionsMoved` runs at a session's creation, wake, move into a new session, sleep and disposal.
- VS Code main at `37eba093`: the count is the number of sessions with a chat whose reduced state has an active turn.
- `rg -n "activeSessions" packages/*/test` - `host-catalogue`, `presence`, `session-sleep`, `session-wakeup-tool` and the server's `plugin-live` read the number as the sessions held open.

### Runtime path

```
chat action -> emit -> the chat's state reduced -> chatMoved -> activeSessionsMoved -> root/activeSessionsChanged
chat closed or session disposed or slept -> activeSessionsMoved
root subscribe -> rootSeed -> activeCount
```

### Gaps

- The count is every session started and not disposed, asleep or running.
- The Sessions window shows it as the host's running sessions, and ranks a host holding sleeping sessions as busy.
- The specification's text counts non-disposed sessions; VS Code's host counts sessions with an active turn, and decides here.
- `activeSessionsMoved` compares with the last number it said, from -1, so its first call says the number whatever the root's clients hold.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A session counts while any of its chats has an active turn in its reduced state, a worker's chat included | [agentHostStateManager.ts#L3250-L3262](https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/agentHostStateManager.ts#L3250-L3262) | 01 |
| The number is said when it differs from the one the root's state holds | [agentHostStateManager.ts#L3162-L3188](https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/agentHostStateManager.ts#L3162-L3188) | 01 |
| It is read again after every chat action, and after a chat closes or a session sleeps or goes | [agentHostStateManager.ts#L2368-L2377](https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2368-L2377); [agentHostStateManager.ts#L1881-L1887](https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/agentHostStateManager.ts#L1881-L1887) | 01 |
| A session nothing is running has no turn, so it never counts | [code://packages/sdk/src/host/catalogue.ts#L494](../../../../packages/sdk/src/host/catalogue.ts#L494) | 01 |
| The tests that read the number as the sessions held open read a sleep, a wake and an unload by what each one changes | `(defaulted: the number counts turns, and those tests hold a session's life)` | 01 |
| `AHP.md`, `HOST.md` and `SESSIONS.md` say what the number counts | [code://docs/sdk/AHP.md#L188](../../../../docs/sdk/AHP.md#L188) | 01 |

## Proposed architecture

- **State flow** - `activeCount` reads every running session's chats, and counts the sessions with a chat whose held state has an active turn.
- **Event flow** - `chatMoved` and the sites that close a chat or let a session go call `activeSessionsMoved`.
- **Announcement** - `activeSessionsMoved` says the number when the root's state holds another.
- **Source-of-truth files** - [`code://packages/sdk/src/host/catalogue.ts`](../../../../packages/sdk/src/host/catalogue.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The count is the sessions with a turn running](task-01-the-count-is-the-sessions-with-a-turn-running.md) | todo | - |

## Risks and tradeoffs

- A client that read the number as the sessions held open reads how many are working.
- ahpw shows it as "Active sessions", which then means sessions at work.

## Resume state

- **Done so far:** planned 2026-11-02.
- **Next action:** [task-01-the-count-is-the-sessions-with-a-turn-running.md](task-01-the-count-is-the-sessions-with-a-turn-running.md).
- **Open questions:** none.
- **Watch out for:** a chat's reducer clears `activeTurn` to `null` at a turn's end, so a turn runs while the field holds an object.

## Final verification checklist

- [ ] Each new or changed case fails on `6e6d1ca8` for the reason it names, and passes after the change.
- [ ] The touched suites pass.
- [ ] `pnpm run typecheck` and `pnpm run boundary` report no errors, and the prose lint is clean.
