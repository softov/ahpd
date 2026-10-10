---
title: A chat is reordered in its session, or moved to another session of the same agent and machine
domain: host
status: built
priority: medium
created: 2026-10-03
revalidated: 2026-10-04
requires:
  - plans/host/47-ahpd-serves-what-ahp-1-0-0-added/plan.md
  - plans/host/44-ahpd-speaks-ahp-1-0-0-p1-ahpd-speaks-1-0-0-and-0-9-0/plan.md
  - plans/host/50-a-peer-chat-is-its-own-conversation/plan.md
refs:
  - "[code://packages/sdk/src/host.ts#L1021-L1026](../../../../packages/sdk/src/host.ts#L1021-L1026) - a method with no handler is `-32601`, which is what `moveChat` gets today"
  - "[code://packages/sdk/src/host/gate.ts#L79-L80](../../../../packages/sdk/src/host/gate.ts#L79-L80) - `createChat` and `disposeChat` in `NEEDS`, where `moveChat` goes"
  - "[code://packages/sdk/src/host/state.ts#L12-L41](../../../../packages/sdk/src/host/state.ts#L12-L41) - `Held`: `chats` in the order they were opened, one agent, config and folder set"
  - "[code://packages/sdk/src/host/catalogue.ts#L55-L65](../../../../packages/sdk/src/host/catalogue.ts#L55-L65) - `chatSummary`, which carries no `movable`"
  - "[code://packages/sdk/src/host/spawn.ts#L311-L320](../../../../packages/sdk/src/host/spawn.ts#L311-L320) - `spawn`: a running backend `Session` keeps the session URI in its closures, so a chat cannot be re-parented in place"
  - "[code://packages/sdk/src/host/lifecycle.ts#L422-L443](../../../../packages/sdk/src/host/lifecycle.ts#L422-L443) - `restartChat`: close, then spawn again with `{ resume: agentId(), seed: allTurns() }`, the move's mechanism"
  - "[code://packages/sdk/src/host/snapshots.ts#L230-L245](../../../../packages/sdk/src/host/snapshots.ts#L230-L245) - the session state's `chats`: peer chats, then live workers, then restored workers"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L576](../../../../packages/sdk/src/host/sessionmethods.ts#L576) - the `createChat` handler, the shape a `moveChat` handler copies"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L689-L719](../../../../packages/sdk/src/host/sessionmethods.ts#L689-L719) - `disposeChat`: `session/defaultChatChanged` then `session/chatRemoved`"
  - "[code://packages/sdk/src/host/state.ts#L113-L142](../../../../packages/sdk/src/host/state.ts#L113-L142) - `claims`: each name is claimed for the session it belongs to, and a move re-claims it"
  - "[code://packages/sdk/src/types/sessions.ts#L93-L95](../../../../packages/sdk/src/types/sessions.ts#L93-L95) - `sender`, kept per session id and turn, which moves with the chat"
  - "[code://packages/sdk/src/types/sessions.ts#L143-L145](../../../../packages/sdk/src/types/sessions.ts#L143-L145) - `chatTitle`, kept per session id, which moves with the chat"
  - "[code://packages/sdk/src/nested.ts#L372-L375](../../../../packages/sdk/src/nested.ts#L372-L375) - a nested host starts a fresh inner session and cannot resume a chat by its id"
  - "npm://@microsoft/agent-host-protocol@1.0.0 - `MoveChatParams`, `MoveChatResult`, `ChatMoveDestination` (`channels-chat/commands.ts:126-220`); `ChatState.movable` and `ChatSummary.movable`, absent meaning `false`, never `true` on the default chat (`channels-chat/state.ts:72-79`, `:197-203`); `chat/movableChanged`, with the host updating the catalogue through `session/chatUpdated` (`channels-chat/actions.ts:579-595`); `session/chatsReordered`, naming every chat exactly once (`channels-session/actions.ts:120-136`, reducer `channels-session/reducer.ts:199-217`)"
  - "https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/protocolServerHandler.ts#L1720-L1722 - VS Code answers `moveChat` with `MethodNotFound`, and nothing in its agent host sets `movable` or sends `session/chatsReordered`"
  - "https://github.com/microsoft/vscode/commit/14b9d22f9a9 - \"explicitly returning MethodNotFound until chat move behavior is implemented separately\""
  - "https://github.com/microsoft/agent-host-protocol/commit/2265e2e - the chat move and reorder contract (#484)"
---

## Goal

A person can put a chat where they want it: earlier or later among its session's chats, into another session running the same agent on the same machine, or out into a session of its own.
A chat says it can move only when a move would work: it is not the default chat, its backend can pick its conversation up again by its own id, and neither it nor any chat it carries is running a turn.
This goes past VS Code, whose agent host refuses `moveChat` at `7516b04bc94`.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "moveChat|MoveChat|movable|ChatsReordered" src/vs/platform/agentHost` in the VS Code clone, generated protocol excluded - only the `MethodNotFound` handler.
- `rg -n "moveChat|movable|chatsReordered" packages` - nothing; `moveChat` falls through to the unknown-method answer.
- The backend id each chat runs under and whether peer chats survive a restart - host/50's reconnaissance: Claude, pi and cofold run a peer chat under the session's id, ACP under its own server id, nested under a fresh inner session; no peer chat is rebuilt after a restart.

### Per backend

| Backend | Where a chat's conversation lives | What a move does | Can move |
| --- | --- | --- | --- |
| Claude | the CLI's transcript, `~/.claude/projects/<encoded cwd>/<backend id>.jsonl`, found by the working directory | respawn under the destination with `resume: <backend id>` and the chat's own folders, so the CLI finds the same file | yes, after host/50 |
| pi | pi's session file under its session directory, by backend id | respawn with `resume: <backend id>` | yes, after host/50 |
| cofold | cofold's store conversation, by backend id | respawn with `resume: <backend id>` | yes, after host/50 |
| ACP | the agent server's own session, by the id it gave, resumed with `loadSession` | respawn with `resume: agentId()`; a server without `loadSession` cannot | only when the server advertises `loadSession` |
| nested | a fresh inner session each start | none: `resume` is ignored | no, `movable` stays `false` |

### Gaps

- No `movable`, no `moveChat` handler, no stored catalogue order.
- A move needs a peer chat that is its own conversation and is rebuilt after a restart, which is host/50.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| Both are built: reordering inside a session, and moving to another session or a new one | Softov, 2026-10-03, asked "VS Code refuses moveChat (MethodNotFound) and never marks a chat movable. Stop at parity, or build reorder and move-between-sessions anyway?": "build both" | 02, 03, 04 |
| A move is accepted only into a session of the same agent provider on the same machine; another provider or another computer is refused with a reason, and those moves are deferred, open for later | Softov, 2026-10-03, asked "Moving a chat between sessions: which destinations does ahpd accept?": "Same agent and machine for now... future case open" | 03 |
| `movable` is `false` while the chat or any chat it carries runs a turn, `true` again after; the default chat is always `false` | Softov, 2026-10-03, asked "When may a chat be moved?": "Not during a turn" | 04 |
| `movable` is `false` for a chat whose backend cannot resume it by its own id: every nested chat, and an ACP chat whose server lacks `loadSession` | (defaulted: a move respawns the chat, and a backend that cannot resume would start it empty) | 04 |
| A move respawns the chat under the destination as `restartChat` does, with `{ resume: <backend id>, seed: allTurns() }`, and its workers with it | [`code://packages/sdk/src/host/spawn.ts#L311-L320`](../../../../packages/sdk/src/host/spawn.ts#L311-L320): a running `Session` holds the session URI in its closures | 03 |
| A moved chat keeps its own folders, whatever the destination's are | (defaulted: Claude finds a transcript by the working directory, and the chat's folders are its own in AHP) | 03 |
| `newSession` makes a session whose id is the chat's backend id and whose default chat is the moved chat, under the chat's URI | (defaulted: the session then resumes that conversation by its own id after a restart, and the chat keeps its URI as the spec says) | 03 |
| `moveChat` asks `session:write` on the source today, and `chat:move` once host/46 lands; the destination session is checked for `session:write` too | host/46 task 02's table, row `moveChat`; (defaulted: a move writes both sessions) | 02, 03 |
| `session/chatsReordered` and `chat/movableChanged` go to a 0.9.0 connection too | AHP 1.0.0 `ACTION_INTRODUCED_IN`: both `0.9.0` | 02, 04 |

## Proposed architecture

- **Data flow** - `moveChat` -> validate -> same session: reorder `held.chats`, store the order, `session/chatsReordered` -> another or a new session: close the chat and its workers, move store keys and claims, spawn under the destination with `resume` and `seed`, `session/chatRemoved` on the source, `session/chatAdded` and `session/chatsReordered` on the destination -> `root/sessionSummaryChanged` for both.
- **State flow** - `movable` is computed from the chat's place, its backend and the running turns, and changes go out as `chat/movableChanged` with `session/chatUpdated`.
- **Layer responsibilities** - sdk host: the handler, `movable`, the respawn · sdk store: the order and the moved keys (host/50's chat list).
- **Source-of-truth files** - [`code://packages/sdk/src/host/sessionmethods.ts`](../../../../packages/sdk/src/host/sessionmethods.ts), [`code://packages/sdk/src/host/state.ts`](../../../../packages/sdk/src/host/state.ts), [`code://packages/sdk/src/host/spawn.ts`](../../../../packages/sdk/src/host/spawn.ts), [`code://packages/sdk/src/host/lifecycle.ts`](../../../../packages/sdk/src/host/lifecycle.ts), [`code://packages/sdk/src/host/catalogue.ts`](../../../../packages/sdk/src/host/catalogue.ts), [`code://packages/sdk/src/host/snapshots.ts`](../../../../packages/sdk/src/host/snapshots.ts), [`code://packages/sdk/src/host/gate.ts`](../../../../packages/sdk/src/host/gate.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - moveChat is refused as VS Code refuses it](task-01-movechat-is-refused-as-vs-code-refuses-it.md) | dropped | - |
| [04 - A chat says when it can move](task-04-a-chat-says-when-it-can-move.md) | done | host/50 |
| [02 - A chat is reordered inside its session](task-02-a-chat-is-reordered-inside-its-session.md) | done | 04 |
| [03 - A chat moves to another session or a new one](task-03-a-chat-moves-to-another-session-or-a-new-one.md) | done | 02 |

## Risks and tradeoffs

- VS Code's client sees `movable: true` from ahpd and offers a move its own host never makes; that client is what the move is tested against by hand.
- A move closes and respawns a backend process, so it costs what a restart costs; it is refused during turns, so nothing in flight is cut.

## Resume state

- **Done so far:** tasks 04, 02 and 03 built 2026-10-09; task 01 dropped.
- **Next action:** none; see [implemented.md](implemented.md).

## Final verification checklist

- [ ] A peer chat reordered, moved to another session and moved to a new one keeps its URI and turns, and a turn sent on it after each move runs.
- [ ] A move to another provider or computer, a move during a turn and a move of a nested chat are refused with nothing changed.
- [ ] `pnpm test` passes.
- [ ] `plans/index.md` updated.
