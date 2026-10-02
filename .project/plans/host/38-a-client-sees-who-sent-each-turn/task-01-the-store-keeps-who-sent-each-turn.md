---
title: The store keeps who sent each turn
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/types/sessions.ts](../../../../packages/sdk/src/types/sessions.ts) - `SessionStore`, where the owner is kept and the turn senders would sit beside it"
  - "[code://packages/sdk/src/sessions.ts](../../../../packages/sdk/src/sessions.ts) - the memory and file stores, `ownerOf` and the `Saved` shape"
  - "[code://packages/sdk/src/host.ts#L3614-L3679](../../../../packages/sdk/src/host.ts#L3614-L3679) - the per-chat emit, where `dispatch` happens, a queued sender moves and `senderOf` is read"
  - "[code://packages/sdk/src/host.ts#L4322-L4331](../../../../packages/sdk/src/host.ts#L4322-L4331) - `senders` and `senderOf`, held only while a turn runs"
  - "[code://packages/sdk/src/host.ts#L5103-L5148](../../../../packages/sdk/src/host.ts#L5103-L5148) - `beginOrRun`, where a sender is recorded under `queuedAs ?? turnId`"
  - "[code://packages/sdk/test/plugin-events-fire.test.ts](../../../../packages/sdk/test/plugin-events-fire.test.ts) - `watched`, `PEOPLE` and the queued-message sender case, and the `peer` whose `notes` are the frames"
---

## Objective

`SessionStore` keeps each turn's sender by turn id, so the answer outlives the turn it belongs to, and a live `chat/turnStarted` carries `_meta.sender` on the wire.
Nothing is written and nothing is sent where there is nobody to name: a host with no users directory sends the same turn it sends today, byte for byte.

## Files

- `UPDATE: packages/sdk/src/types/sessions.ts:73-97` - `sender(id, turnId)` and `setSender(id, turnId, value)` beside `owner`/`setOwner`, which is the port's existing shape for one typed reference per session, keyed a second time.
- `UPDATE: packages/sdk/src/sessions.ts:29-70` - a map of maps beside `chatTitles`, and one more map in `forget`.
- `UPDATE: packages/sdk/src/sessions.ts:16-19` - `sendersOf(id)` on the interface that holds what the port cannot answer, which is the whole session's senders at once.
- `UPDATE: packages/sdk/src/sessions.ts:95-109` - `senders?: Record<string, string>` on `Saved`, beside `owner`.
- `UPDATE: packages/sdk/src/sessions.ts:142-171` - `save()` writing the map, and the row filter at 168-170 counting it as something worth a line.
- `UPDATE: packages/sdk/src/sessions.ts:193-250` - `load()` reading each value through `ownerOf`, the guard at 92 that a typed reference is and nothing else.
- `UPDATE: packages/sdk/src/sessions.ts:254-271` - the file store's pass-through, which registers the id as known and coalesces the write.
- `UPDATE: packages/sdk/src/host.ts:3614-3679` - the emit: the queued move before the dispatch, the stamp on the action, and the write to the store.

## Steps

1. The port takes `sender(id: string, turnId: string): Owner | undefined` and `setSender(id: string, turnId: string, value: Owner | undefined): void`, beside `owner` at `types/sessions.ts:82-84` and worded the way that one is. `undefined` is the answer for a turn nobody is recorded as having sent: one sent before this was kept, and a worker's turn the host opened itself rather than a person asking. The doc comment says why a second key is needed at all, which is that two people can be talking in one session and only the turn says which of them it was.
2. `memorySessions` holds `const senders = new Map<string, Map<string, Owner>>()`, exactly the shape `chatTitles` holds at line 37, because the answer is per turn inside a session rather than per session. `setSender` deletes the turn on `undefined` and drops the session's map once it is empty, which is what `setChatTitle` does at lines 55-62. The map joins `forget` at line 68.
3. `fileSessions` needs the whole map to write a row down, which the port cannot give it, so `sendersOf(id): Record<string, Owner> | undefined` goes on the interface at lines 16-19 beside `chatTitlesOf`. `Saved.sessions[]` gains `senders?: Record<string, string>`, `save()` spreads it the way `chatTitles` is spread at line 164 and the filter at 168-170 accepts it. `load()` walks the map and passes every value through `ownerOf`, so a row written by something that meant something else is ignored rather than guessed at, as an owner that is not a typed reference already is.
4. In the emit, the queued-message move at `host.ts:3629-3633` has to happen before the `dispatch` at 3615, not after it. A queued message is recorded under the id the host gave it, because that is the only id it has, and the backend is what says which turn it became - so the sender of a queued turn is not known until that action arrives, and an action that goes out before the move leaves is the action a client sees with nothing on it. Move the block up; it touches only `senders`.
5. In the same place, read the sender once after the move and put it on the action the dispatch carries: `chat/turnStarted` goes out as `{ ...action, _meta: { ...(action._meta as Bag | undefined), sender: who } }` when there is a `who`, and exactly as it is when there is not. `ChatTurnStartedAction` declares `_meta?: Record<string, unknown>`, so this is a place the protocol has rather than one it does not, and the wire test is what says so.
6. In the same place, `kept.setSender(idOf(uri), turn, who)` for the same `who`, against the host's own id for the session the way every other `kept` call here is made. This is the one place a turn of this host's begins: a turn a client dispatched, a queued message taken up, and an automation's first turn (`host.ts:6516` records its sender before `chat.begin`, so its turn arrives here like any other) all pass through it. Only the turn id is ever written, never the queued message's.
7. The in-memory entry is still dropped at turn end, at the line 3657. What that map is for - the usage meter and the plugin events - has been read off it by then, and what a history needs is now the store's. Rewrite the comment above `senders` at 4322-4326, which today says the opposite: that nothing is kept for a session's history and the usage record will already have it.

## Validation

- `packages/sdk/test/sessions.test.ts` - a new case beside "keeps whose work a session is across a restart, and forgets it with the session" (line 226): two turns' senders written through `fileSessions` come back from a second store on the same file, `forget` takes them, and a sender cleared with `undefined` leaves `sessions: []` the way the flags case at line 125 does.
- The same file, the "reads a row that names no owner as one nobody owns" case (line 295) extended with a `senders` map holding a value that is not a typed reference, which reads back as nothing.
- `packages/sdk/test/plugin-events-fire.test.ts` - a new case beside "names who sent each turn, and a queued message keeps its sender when it runs" (line 242), reading the wire rather than the plugin events: the host is built with `users: directory()` and a client accepted under `PEOPLE.ana` that subscribes to its chat first, and the `chat/turnStarted` frame in `peer.notes` carries `_meta.sender: 'user:ana'`. The same case with no `users` in `watched()` carries no `_meta` at all.
- `npm test` - `tools/schema.mjs` regenerates the strict schema and `packages/sdk/test/wire.test.ts` asserts no undeclared key on any frame, which is the check that would catch `_meta` put somewhere the protocol does not declare it. That host is built without `users`, so it also holds the absence: nothing on its capture may carry `_meta.sender`.
