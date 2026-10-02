---
title: A client sees who owns a session and who sent each turn
domain: host
status: planned
priority: medium
created: 2026-10-02
revalidated: 2026-10-02
requires:
  - plans/host/34-work-says-who-owns-it/plan.md
changes: []
creates: []
decisions: []
refs:
  - "[code://packages/sdk/src/host.ts#L3614-L3679](../../../../packages/sdk/src/host.ts#L3614-L3679) - the per-chat emit, where a turn's sender is read, `dispatch` happens and `turn_start` fired"
  - "[code://packages/sdk/src/host.ts#L4322-L4331](../../../../packages/sdk/src/host.ts#L4322-L4331) - `senders` and `senderOf`, held only while a turn runs"
  - "[code://packages/sdk/src/host.ts#L3932-L4026](../../../../packages/sdk/src/host.ts#L3932-L4026) - `listing()`, which builds every session summary"
  - "[code://packages/sdk/src/types/sessions.ts](../../../../packages/sdk/src/types/sessions.ts) - `SessionStore`, where the owner is kept and the senders would be"
  - "[code://packages/sdk/src/sessions.ts](../../../../packages/sdk/src/sessions.ts) - the memory and file stores, `ownerOf` and the `Saved` shape a restart reads back"
  - "[code://packages/sdk/src/host.ts#L3029-L3054](../../../../packages/sdk/src/host.ts#L3029-L3054) - `describes`, spread into both a `SessionState` and a `SessionSummary`, where a row's `_meta` is composed"
  - "[code://packages/sdk/src/host.ts#L2105-L2128](../../../../packages/sdk/src/host.ts#L2105-L2128) - `withWorkerUri` and `stampedCalls`, the pattern a turn copied rather than mutated follows"
  - "[code://packages/sdk/src/host.ts#L6103-L6125](../../../../packages/sdk/src/host.ts#L6103-L6125) - the live chat snapshot, `turns` and `activeTurn`"
  - "[code://packages/sdk/src/host.ts#L6140-L6192](../../../../packages/sdk/src/host.ts#L6140-L6192) - a session read out of its transcript, and a worker chat read the same way"
  - "[code://packages/sdk/src/host.ts#L7265-L7300](../../../../packages/sdk/src/host.ts#L7265-L7300) - `fetchTurns`, and the `chat/turnsLoaded` page it dispatches"
  - "[code://packages/sdk/test/wire.test.ts](../../../../packages/sdk/test/wire.test.ts) - the gate that closes every object the host sends, and the fixture it writes"
  - "[code://packages/sdk/test/sessions.test.ts](../../../../packages/sdk/test/sessions.test.ts) - the store harness, and the owner cases a sender case sits beside"
  - "[code://packages/sdk/test/plugin-events-fire.test.ts](../../../../packages/sdk/test/plugin-events-fire.test.ts) - `PEOPLE`, `directory()` and the queued-message sender case, and the `peer` whose `notes` are the frames"
---

## Goal

A client such as ahpapp can say whose a session is and which person sent each of its turns, live and after a restart, from what the host puts on the wire.
Today the owner and sender exist inside the host (host/34) and reach plugins only; no client is told.

## Reconnaissance

### Runtime path

```
sendMessage -> senders (turn id -> owner, dropped at turn end) -> turn_start/turn_end plugin events only
session owner -> SessionStore.owner -> never on a summary
```

### Gaps

- No `_meta` on `chat/turnStarted`, a historic turn or a session summary names a person.
- A turn's sender is forgotten when the turn ends, so a session's history cannot say who sent what.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| `_meta.sender` on `chat/turnStarted` and on every historic turn, `_meta.owner` on the session summary, as typed references (`user:<id>`, `root:<host>`) | Softov, 2026-10-02, asked "For ahpapp to show who sent each turn and who owns a session... How?": "`_meta` on the wire" | 01, 02 |
| The session store keeps each turn's sender by turn id, so history carries it after a restart | (defaulted: the only way a historic turn can say who sent it; host/34 kept nothing past the turn) | 01 |
| A host with no users directory sends neither | host/34: no owner is recorded there | 01, 02 |
| A turn sent before this was kept has no `_meta.sender` | (defaulted: nothing to read) | 02 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The store keeps who sent each turn](task-01-the-store-keeps-who-sent-each-turn.md) | todo | - |
| [02 - A turn and a session say who, on the wire](task-02-a-turn-and-a-session-say-who-on-the-wire.md) | todo | 01 |
| [03 - The docs say who sent what](task-03-the-docs-say-who-sent-what.md) | todo | 01, 02 |

## Resume state

- **Done so far:** planned 2026-10-02; the three task files written 2026-10-02.
- **Next action:** [task-01-the-store-keeps-who-sent-each-turn.md](task-01-the-store-keeps-who-sent-each-turn.md).
- **Open questions:**
  1. `Turn` and `ActiveTurn` declare no `_meta`, and `ChatTurnsLoadedAction` declares none, while `tools/schema.mjs` closes every object with `additionalProperties: false`. So `_meta.sender` written on a historic turn is an undeclared key and `packages/sdk/test/wire.test.ts` fails on it. Where does a historic turn's sender ride - proposed: on the turn's `message`, which declares `_meta`, so a client reads `turn.message._meta.sender` in a snapshot and in `chat/turnsLoaded`, and `action._meta.sender` on the live `chat/turnStarted`. The other way is to ask the protocol package for `Turn._meta`, which is a change in another repository and holds this plan behind a version bump.
- **Watch out for:** the emit dispatches the action before the queued sender moves, so the move has to go above the dispatch before anything can be stamped onto what goes out.

## Final verification checklist

- [ ] A turn sent by `user:ana` carries `_meta.sender: "user:ana"` live and after a restart.
- [ ] A session summary carries its owner.
- [ ] A host with no users directory sends neither.
- [ ] `plans/index.md` updated.
