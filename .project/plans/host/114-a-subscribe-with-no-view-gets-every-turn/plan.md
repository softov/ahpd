---
title: A subscribe with no view gets every turn
domain: host
status: built
priority: medium
created: 2026-10-22
revalidated: 2026-10-28
problems:
  - problems/a-nested-chat-hands-on-an-older-inner-cut.md
refs:
  - https://github.com/microsoft/agent-host-protocol/blob/main/types/common/commands.ts - `SubscribeView.turns`: "When omitted, the host MUST return all retained turns"
  - https://github.com/microsoft/agent-host-protocol/blob/main/docs/specification/subscriptions.md#snapshot-views - the same rule, and "If older turns are available, `ChatState.turnsNextCursor` is present"
  - https://github.com/microsoft/agent-host-protocol/blob/main/docs/specification/chat-channel.md - `view.turns` is advisory, and `fetchTurns` prepends older turns with `chat/turnsLoaded`
  - https://github.com/microsoft/agent-host-protocol/blob/main/types/channels-session/commands.ts - `FetchTurnsParams.cursor`: omit it "only when asking the host to opportunistically load its next older page for the chat, if any"
  - npm://@microsoft/agent-host-protocol@1.0.0 - the published `SubscribeView` has the same MUST, so the rule is in the version ahpd speaks
  - "[code://packages/sdk/src/sessions/paging.ts#L22-L56](../../../../packages/sdk/src/sessions/paging.ts#L22-L56) - `PAGE` is 50, `tail` gives the newest page and a cursor, `older` gives the page before a cursor"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L380-L434](../../../../packages/sdk/src/host/sessionmethods.ts#L380-L434) - `subscribe`, which never reads `params.view` and calls `snapshotOf` without it"
  - "[code://packages/sdk/src/host/snapshots.ts#L73](../../../../packages/sdk/src/host/snapshots.ts#L73) - `snapshotOf(channel, mine, connection)`, which has no place for a view"
  - "[code://packages/sdk/src/host/snapshots.ts#L322-L351](../../../../packages/sdk/src/host/snapshots.ts#L322-L351) - a live chat's snapshot, which takes the turns the backend's `chatState()` gives"
  - "[code://packages/sdk/src/host/snapshots.ts#L411-L500](../../../../packages/sdk/src/host/snapshots.ts#L411-L500) - a chat that is not running: a peer chat, a worker chat and the session's chat, each cut with `tail`"
  - "[code://packages/agent-claude/src/session.ts#L245-L266](../../../../packages/agent-claude/src/session.ts#L245-L266) - Claude's `chatState()`, which cuts its turns with `...tail(ctx.turns)` at line 256"
  - "[code://packages/agent-acp/src/session.ts#L247](../../../../packages/agent-acp/src/session.ts#L247) - the ACP backend's `chatState()` gives every turn"
  - "[code://packages/agent-pi/src/session.ts#L1264](../../../../packages/agent-pi/src/session.ts#L1264) - the pi backend's `chatState()` gives every turn"
  - "[code://packages/agent-cofold/src/session.ts#L316](../../../../packages/agent-cofold/src/session.ts#L316) - the cofold backend's `chatState()` gives every turn"
  - "[code://packages/bot/src/chat.ts#L894](../../../../packages/bot/src/chat.ts#L894) - a bot chat's `chatState()` gives every turn"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L444-L500](../../../../packages/sdk/src/host/sessionmethods.ts#L444-L500) - `fetchTurns`, which reads every turn from `allTurns()` or the transcript, and pages from the cursor"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L474](../../../../packages/sdk/src/host/sessionmethods.ts#L474) - with no cursor, `fetchTurns` starts at `tail(all).turnsNextCursor`, which assumes the snapshot was the newest `PAGE`"
  - "[code://packages/sdk/src/host/handshake.ts#L217](../../../../packages/sdk/src/host/handshake.ts#L217) - the snapshots of `initialSubscriptions`, which name only URIs"
  - "[code://packages/sdk/src/host/handshake.ts#L444-L490](../../../../packages/sdk/src/host/handshake.ts#L444-L490) - the snapshots of a `reconnect`, which names only URIs"
  - "[code://packages/sdk/src/host/tooling.ts#L1637-L1652](../../../../packages/sdk/src/host/tooling.ts#L1637-L1652) - `get_session_context` reads `chatState()`, and says `hasMoreHistory` when a cursor is there"
  - "[code://packages/sdk/src/tools/session.ts#L630](../../../../packages/sdk/src/tools/session.ts#L630) - `transcriptLimit`, which already cuts that tool's transcript to at most 50 turns"
  - "[code://packages/sdk/src/sessions/nested.ts#L1063](../../../../packages/sdk/src/sessions/nested.ts#L1063) - a nested chat gives the inner host's turns and cursor as they came"
  - "[code://packages/sdk/src/rpc.ts#L166](../../../../packages/sdk/src/rpc.ts#L166) - a client whose queue is past `clientQueueBytes` is closed at the next send"
  - "[code://packages/sdk/test/host-catalogue.test.ts#L278-L381](../../../../packages/sdk/test/host-catalogue.test.ts#L278-L381) - the paging cases, which expect 50 turns and cursor `70` from a subscribe with no view"
  - "[code://packages/sdk/test/sessions.test.ts#L1182-L1203](../../../../packages/sdk/test/sessions.test.ts#L1182-L1203) - the oldest-page case, which sends `fetchTurns` with no cursor to a chat whose snapshot was whole"
  - "[code://docs/sdk/AHP.md#L94](../../../../docs/sdk/AHP.md#L94) - the `fetchTurns` row says \"Newest 50 in the snapshot and a cursor for the rest\""
  - "[code://UPSTREAM.md](../../../../UPSTREAM.md) - Pass 7, \"Large chats\", holds the box this plan closes"
  - https://github.com/microsoft/vscode/blob/1.143.1/src/vs/platform/agentHost/node/protocolServerHandler.ts - VS Code's host reads no `view` at subscribe, and answers `fetchTurns` with an empty `chat/turnsLoaded`
  - https://github.com/microsoft/vscode/blob/1.143.1/src/vs/platform/agentHost/node/shared/sessionServerTools.ts - VS Code's `get_session_context` takes every turn of the state and cuts it with `transcriptLimit`
  - https://github.com/ahpio/ahpc/blob/4741023/src/ahp/live.ts#L1960-L1990 - ahpc subscribes with no view, and sends `fetchTurns` with the cursor it holds or with none
  - https://github.com/ahpio/ahpc/blob/4741023/src/ahp/live.ts#L2876-L2890 - ahpc asks for older turns once, only when the snapshot has no turns and has a cursor
  - https://github.com/softov/ahpw/blob/e9d6320/src/resources/sessions/Page.tsx#L133-L296 - ahpw subscribes with no view, and shows "older" only while the state has a cursor
---

## Goal

A client that subscribes to a chat and names no `view` must get every turn the host keeps.
ahpd sends only the newest 50 turns, with a cursor for the rest, whatever the subscribe asks.
A VS Code window never sends `view` and never sends `fetchTurns`.
So it shows the newest 50 turns of a long chat, and nothing before them.
After this plan, a subscribe with no view gets every turn, and a subscribe with a view gets a shorter window and a cursor.
The first task shows the cut in a test and in a VS Code 1.143 window before anything changes.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `git grep -n "tail(\|older(\|PAGE\b\|turnsNextCursor\|fetchTurns\|params.view" -- packages` - `tail` is called at `snapshots.ts` lines 444, 473 and 492 and at `agent-claude/src/session.ts` line 256. `fetchTurns` calls `tail` and `older`. No file reads `view`.
- `git grep -n "chatState: () =>" -- packages` - only `agent-claude` cuts its turns. `agent-acp`, `agent-pi`, `agent-cofold`, `bot` and the nested chat give every turn they hold.
- `git grep -n "snapshotOf(" -- packages/sdk/src` - four callers: `subscribe`, the `initialSubscriptions` of `initialize`, and two in `reconnect`. Only `subscribe` has a `view` to give.
- `git grep -n "fetchTurns\|turnsNextCursor\|view" ` in ahpc and ahpw - neither client sends `view`. Both send `fetchTurns` only while the state carries a cursor, and ahpc also when a snapshot has no turns.
- `git grep -n "fetchTurns\|turnsNextCursor" 1.143.1 -- src/vs/workbench src/vs/sessions` in VS Code - the window reads neither.
- `git grep -n "turnsNextCursor\|toHaveLength(50)\|PAGE" -- packages/*/test` - the paging cases in `host-catalogue.test.ts` and the oldest-page case in `sessions.test.ts` depend on the cut.

### Runtime path

```
subscribe {channel: ahp-chat:/..., view?} -> sessionmethods.subscribe -> snapshotOf(channel, mine, connection)
  -> live chat: backend chatState() (Claude cuts to tail) -> linkedTurns -> snapshot
  -> chat not running: past(id) transcript -> tail(...) -> snapshot
  -> client draws turns, and pages with fetchTurns only when it reads turnsNextCursor
```

### Gaps

- `subscribe` drops `params.view`, so the host cannot tell "no view" from "a view".
- A snapshot of a chat that is not running is cut to `PAGE` at three sites.
- Claude's `chatState()` cuts to `PAGE`, unlike every other backend.
- `fetchTurns` with no cursor starts at the newest `PAGE`, which is wrong once a snapshot can be whole.
- The `fetchTurns` row in `docs/sdk/AHP.md` says the snapshot has the newest 50.
- A nested chat gives the inner host's cursor, but the outer host answers `fetchTurns` from its own copy of the turns. This plan does not change that, and [the problem file](../../../problems/a-nested-chat-hands-on-an-older-inner-cut.md) records it.
- `Not found: a test that subscribes with a view - searched "view" in packages/sdk/test and packages/agent-claude/test.`

## Answers

| What | Source | Task |
| --- | --- | --- |
| This finding becomes a plan: answer every retained turn when a subscribe names no view, as the spec says | Softov, 2026-10-22: "50-turn snapshot: answer all retained turns when a subscribe names no view, as the spec says; verify the cut in VS Code first" | 01-05 |
| The first task shows the cut with a host test and with a check by hand in a VS Code 1.143 window, in [`pending/host-114-turn-cut-checks.md`](../../../pending/host-114-turn-cut-checks.md) | Softov, 2026-10-22, same words: "verify the cut in VS Code first" | 01 |
| With no `view`, a chat snapshot has every turn and no `turnsNextCursor` | https://github.com/microsoft/agent-host-protocol/blob/main/types/common/commands.ts `SubscribeView.turns` | 02, 03 |
| The turns a host keeps are the ones `fetchTurns` can page: the backend's `allTurns()` for a live chat, the transcript for a chat that is not running | [code://packages/sdk/src/host/sessionmethods.ts#L449](../../../../packages/sdk/src/host/sessionmethods.ts#L449) | 02 |
| `initialSubscriptions` and `reconnect` give no view, so their chat snapshots have every turn | https://github.com/microsoft/agent-host-protocol/blob/main/types/common/commands.ts `InitializeParams.initialSubscriptions` and `ReconnectParams.subscriptions` are URIs only | 02 |
| The host applies the view, and Claude's `chatState()` gives every turn, as the other backends do | [code://packages/agent-acp/src/session.ts#L247](../../../../packages/agent-acp/src/session.ts#L247), [code://packages/agent-pi/src/session.ts#L1264](../../../../packages/agent-pi/src/session.ts#L1264), [code://packages/bot/src/chat.ts#L894](../../../../packages/bot/src/chat.ts#L894) | 02, 03 |
| `get_session_context` keeps its own cut, `transcriptLimit`, and gets no change | [code://packages/sdk/src/tools/session.ts#L630](../../../../packages/sdk/src/tools/session.ts#L630), and VS Code's `sessionServerTools.ts` does the same | 03 |
| A subscribe that names `view.turns` gets the newest `view.turns` turns, and a cursor when older turns are left. A value that is not a positive integer gets the newest `PAGE` | Softov, 2026-10-22: "Newest N plus a cursor" | 02, 03 |
| `fetchTurns` with no cursor answers with nothing older and sends no action | Softov, 2026-10-22: "Nothing older" | 02 |
| The cursor of a nested chat stays out of this plan, and [a problem file](../../../problems/a-nested-chat-hands-on-an-older-inner-cut.md) records it | Softov, 2026-10-22: "Problem file only" | - |
| The test that shows the cut is written as `it.fails`, so the suite stays green, and becomes `it` when the fix lands | `(defaulted: a test that fails on main would block every other merge)` | 01, 02, 03 |
| The `PAGE` export and `tail` and `older` stay in the sdk's public surface | `(defaulted: docs/sdk/BUILD-A-HOST.md names them for a host author, and a view still pages with them)` | 02 |

## Proposed architecture

- **Data flow** - `subscribe` gives `params.view` to `snapshotOf`. Every chat snapshot takes its turns through one function in `paging.ts`. With no view, it gives every turn. With a view, it gives a window and a cursor.
- **Event flow** - no new action. `fetchTurns` still sends `chat/turnsLoaded` on the channel.
- **State flow** - the host keeps no record of which window a connection got. The cursor is still the index of the oldest turn sent.
- **Layer responsibilities** - sdk: reads the view and cuts the turns for every chat snapshot · agent-claude: gives every turn from `chatState()`, as the other backends do.
- **Source-of-truth files** - [`code://packages/sdk/src/sessions/paging.ts`](../../../../packages/sdk/src/sessions/paging.ts), [`code://packages/sdk/src/host/snapshots.ts`](../../../../packages/sdk/src/host/snapshots.ts), [`code://packages/sdk/src/host/sessionmethods.ts`](../../../../packages/sdk/src/host/sessionmethods.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The cut is shown](task-01-the-cut-is-shown.md) | done | - |
| [02 - A snapshot follows the subscribe's view](task-02-a-snapshot-follows-the-subscribes-view.md) | done | 01 |
| [03 - Claude's chat state holds every turn](task-03-claudes-chat-state-holds-every-turn.md) | done | 02 |
| [04 - The docs say every turn without a view](task-04-the-docs-say-every-turn-without-a-view.md) | done | 02, 03 |
| [05 - A window shows every turn](task-05-a-window-shows-every-turn.md) | done | 03 |

## Risks and tradeoffs

- A long session gives a large snapshot. The comment on `PAGE` names a session of 850 turns. Task 01 writes down the bytes of a real snapshot, so the size is known before the fix.
- The host closes a client whose queue is past `clientQueueBytes` at the next send. A large snapshot to a slow client can pass the 16 MiB default. Task 01 gives the number to compare.
- `chat/turnsLoaded` goes to every client that watches the chat, and its `turnsNextCursor` replaces each client's cursor. A client with every turn then gets a cursor it did not need. This happens only when another client sent a `view`, and no client in reach sends one.
- An older agent-claude plugin on a new daemon still cuts a live chat to 50. The cursor is there, so `fetchTurns` still works. A new plugin on an older daemon gives every turn of a live chat, which the spec allows.
- A nested chat whose inner host is older still gives the inner cut and cursor. The outer host answers that cursor from its own copy and can refuse it. This plan leaves that as it is, and the problem file records it.

## Resume state

- **Done so far:** built, and Softov checked it by hand in a VS Code window on 2026-11-04. See [implemented.md](implemented.md).
- **Next action:** none.

## Final verification checklist

- [x] A subscribe with no view to a chat of 120 turns gets 120 turns and no cursor. This is true for a live chat and for a chat that is not running.
- [x] A subscribe with a view gets a window and a cursor, and `fetchTurns` walks back to the first turn.
- [x] `pnpm -s build`, `pnpm -s typecheck`, `pnpm -s boundary` and `pnpm test` pass.
- [x] The check by hand in a VS Code 1.143 window shows the first message of a long session.
- [x] The Pass 7 box in `UPSTREAM.md` is ticked.
