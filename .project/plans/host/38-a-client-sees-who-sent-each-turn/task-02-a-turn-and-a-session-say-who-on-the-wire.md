---
title: A turn and a session say who, on the wire
status: todo
depends: [01]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L2105-L2128](../../../../packages/sdk/src/host.ts#L2105-L2128) - `withWorkerUri` and `stampedCalls`, the pattern a turn that is copied rather than mutated follows"
  - "[code://packages/sdk/src/host.ts#L3022-L3054](../../../../packages/sdk/src/host.ts#L3022-L3054) - `describes`, spread into both a `SessionState` and a `SessionSummary`, where a row's `_meta` is composed"
  - "[code://packages/sdk/src/host.ts#L2925-L2970](../../../../packages/sdk/src/host.ts#L2925-L2970) - `metaOf`, the session's whole `_meta`, which `session/metaChanged` replaces as a unit"
  - "[code://packages/sdk/src/host.ts#L2355-L2373](../../../../packages/sdk/src/host.ts#L2355-L2373) - `summaryOf`, and `summaryMoved` at 2401, which carry the row and its partial"
  - "[code://packages/sdk/src/host.ts#L3932-L4026](../../../../packages/sdk/src/host.ts#L3932-L4026) - `listing()`, whose two rows both spread `...describes(uri)`"
  - "[code://packages/sdk/src/host.ts#L6103-L6125](../../../../packages/sdk/src/host.ts#L6103-L6125) - the live chat snapshot, `state.turns` and `state.activeTurn`"
  - "[code://packages/sdk/src/host.ts#L6140-L6192](../../../../packages/sdk/src/host.ts#L6140-L6192) - a session read out of its transcript, and a worker chat read the same way"
  - "[code://packages/sdk/src/host.ts#L7265-L7300](../../../../packages/sdk/src/host.ts#L7265-L7300) - `fetchTurns`, and the `chat/turnsLoaded` page it dispatches"
  - "[code://packages/sdk/test/wire.test.ts](../../../../packages/sdk/test/wire.test.ts) - the gate that closes every object the host sends, and the fixture it writes"
---

## Objective

A historic turn carries who sent it and a session carries whose it is, in every place a client reads either: a chat snapshot, a session opened out of a transcript, a worker chat, a page of older turns, and a catalogue row.
Both are `_meta` keys the protocol already declares where they land, and where there is nothing to say neither key is there: a host with no users directory, and a turn sent before any of this was kept.

## Files

- `UPDATE: packages/sdk/src/host.ts:2105-2128` - `withSender(session, turns)` beside `stampedCalls`, copying a turn only where a sender was found for it.
- `UPDATE: packages/sdk/src/host.ts:6117-6123` - the live chat snapshot, `turns` and `activeTurn`.
- `UPDATE: packages/sdk/src/host.ts:6154-6192` - the browsed session and its worker chat.
- `UPDATE: packages/sdk/src/host.ts:7294-7298` - the `chat/turnsLoaded` page.
- `UPDATE: packages/sdk/src/host.ts:3029-3054` - `describes`, where the row's `_meta` is composed and the owner goes in.
- No change in `summaryOf` (2355-2373), `summaryMoved` (2401-2422) or `listing()` (3932-4026): each of them already spreads `...describes(uri)`, so `_meta.owner` reaches `root/sessionAdded`, `root/sessionSummaryChanged` and `listSessions` from the one place.

## Steps

1. **Depends on the plan's open question, where a historic turn's sender rides.** The protocol declares `_meta` on `Message` and on `ChatTurnStartedAction` and on `SessionSummary` and `SessionState`, and declares none on `Turn`, on `ActiveTurn` or on `ChatTurnsLoadedAction`. Around the proposed answer, write `withSender(session: string, turns: Bag[]): Bag[]` beside `stampedCalls` at 2117: for each turn, `kept.sender(idOf(session), String(turn.id ?? ''))`, and where there is a sender and the turn's `message` is an object, return `{ ...turn, message: { ...message, _meta: { ...(message._meta as Bag | undefined), sender } } }`. The rest of the shape is `stampedCalls` exactly, including the `touched` flag: a copy where something moved and the backend's own object everywhere else, because `chatState()` is the agent's answer and not a place this host writes into.
2. `state.turns` and `state.activeTurn` at 6119 and 6122 take the new helper, wrapped round what is already there so both stamps land on the same array. The running turn is a turn like any other and says the same thing; a client drawing it is the client that has just been told who asked.
3. The browsed session's page at 6183 and a worker chat's at 6164 are the other two, and they are the two that only a store can answer, which is the point: a turn this process did not run is a turn the file has the answer for. A worker's own turn is not stamped, because no sender was ever recorded for it, which is the same absence as a turn sent before this was kept.
4. `fetchTurns` at 7294 stamps `page.turns` before the dispatch, against `idOf(sessionFor(channel))` the way line 7271 reads the session. The action has no `_meta` of its own to put anything in, so the turns are the whole of it; a client that paged back through a conversation must not find the sender gone on the oldest page.
5. `_meta.owner` belongs in `describes`, which is the helper whose stated rule is that only fields both a `SessionState` and a `SessionSummary` declare go in it, and both declare `_meta`. Compose it beside `metaOf`: `const owner = kept.owner(idOf(uri))`, and the returned `_meta` is `{ ...told, ...(owner === undefined ? {} : { owner }) }`.
6. The early return at 3031 has to move, because it currently answers `{}` for a session in no directory and a session with an owner is exactly that. Return `{}` only where there is neither a directory nor an owner, and `{ _meta: { owner } }` where there is an owner and no path. Everything else about the helper is unchanged, `project` still comes from the directory and still goes first.
7. The owner is not put in `metaOf`. That function's contract at 2926-2934 is that `session/metaChanged` replaces the map as a unit, and it returns `undefined` when the session has no directory; an owner belongs to the session rather than to where the session is, and a row whose `_meta` silently lost it the next time a branch was read is worse than one that never had it.
8. Nothing else reaches the wire. A `chat/turnStarted` the client itself dispatched is answered with the same action the host emits, so it carries `_meta.sender` from task 01 as well, and a client that never asks for it is unaffected.

## Validation

- `packages/sdk/test/sessions.test.ts` - the harness there already builds a host with `users: people()` and a client under `ana` (`running(store, { principal: ana })`, line 67), which is this task in one case: ana sends a turn, the store is written, a second host is built on the same file after the coalesced write, and the subscribe answer's snapshot has `turns[0].message._meta.sender === 'user:ana'` and `_meta.owner === 'user:ana'` on the row. The same file, a host built by `running(store)` with no `who`, has neither key anywhere in the snapshot.
- The same file, paging: 51 turns, one `fetchTurns`, and the `chat/turnsLoaded` frame in the peer's `notes` carries `message._meta.sender` on every turn in the page.
- `packages/sdk/test/wire.test.ts` - the assertion `expect(found).toEqual([])` is the whole point of the task and must still hold. That host is built with no `users`, so its capture is the negative case: no `_meta.sender` on any turn and no `_meta.owner` on any row, on every one of the frames it records. A host that sent either here would be an undeclared key and fail.
- `packages/sdk/test/fixtures/wire.jsonl` is rewritten by that test on every run; read the diff, which should be empty apart from the values the test deliberately steadies. It is an output, never an input.
- `npm test` - `tools/schema.mjs` regenerates the strict schema the checker reads, so the run proves the keys landed where the package declares them rather than where this host would like them.

## Resume
