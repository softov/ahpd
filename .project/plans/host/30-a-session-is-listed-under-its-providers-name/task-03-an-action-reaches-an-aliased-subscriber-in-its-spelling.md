---
title: An action reaches an aliased subscriber in its own spelling
status: implemented
depends: [task-01-a-created-session-is-held-under-its-providers-name.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L447-L465](../../../../packages/sdk/src/host.ts#L447-L465) - `broadcast`, which swaps only `channel` for an alias"
  - "[code://packages/sdk/src/host/routing.ts#L166-L243](../../../../packages/sdk/src/host/routing.ts#L166-L243) - `spelledFor`, the rules for which URIs are respelled"
  - "[code://packages/sdk/src/host.ts#L548-L560](../../../../packages/sdk/src/host.ts#L548-L560) - `dispatch`, which builds the envelope under the held channel"
  - "[code://packages/sdk/src/host/spawn.ts#L91-L107](../../../../packages/sdk/src/host/spawn.ts#L91-L107) - `withWorkerUri`, which stamps `_meta.subagentChatUri` in the held spelling"
  - "[code://packages/sdk/test/subagent-chat.test.ts#L534](../../../../packages/sdk/test/subagent-chat.test.ts#L534) - `takes an approval given on a worker chat spelt from a session alias`"
---

## Objective

A connection subscribed to a session or chat under an alias receives each action with the session's URIs inside it in that alias's spelling, the same as its snapshot, so a subagent chat, a pending input or a new chat it is told about has a URI it can match.

## Files

- `UPDATE: packages/sdk/src/host/routing.ts:166-243` - split the per-URI respelling in `spelledFor` into a function that takes one value and the pair (held, asked), so a snapshot and an action use the same rules.
- `UPDATE: packages/sdk/src/host.ts:447-465` - for an aliased connection on a session or chat channel, respell the action with that function, not only `channel`.
- `UPDATE: packages/sdk/test/host.test.ts` or `packages/sdk/test/subagent-chat.test.ts` - the cases below.

## Steps

1. Extract the respelling rules from `spelledFor`: the session URI itself, `ahp-chat://default/<b64>`, `ahp-chat://subagent/<b64>/<call>`, `<session>/changeset/<scope>`, `<session>/annotations`, and only for chats of this session (the "mine" check at 1530-1534).
2. Apply them in `broadcast` to the action of an envelope sent under an alias; leave the canonical copy untouched and do not mutate the shared envelope.
3. Keep `replayable` under the held channel; the replay in `subscribe` (6339-6345) respells with the same function.

## Validation

- A client subscribed as `ahp-session:/<uuid>` receives `session/chatAdded` with `summary.resource` and `summary.origin.chat` in that spelling when a subagent starts.
- The same client receives `session/inputNeededSet` with `request.chat` in that spelling, and `chat/toolCallStart` or `chat/toolCallReady` with `_meta.subagentChatUri` in that spelling.
- A client subscribed under the held name receives the same actions unchanged.
- `conformance.test.ts` still replays every emitted action through the protocol reducers.
- `pnpm -C packages/sdk test` passes.

## Resume

`respell(uri, held, asked)` holds the per-URI rules (the session, anything under `<session>/`, a default or worker chat of this session; a chat a client named or a chat of another session stays), `respelledIn` applies it to every URI in a value as a copy, and `spelledFor` now uses it.
`spellingOf(connection, channel)` finds the pair for a session, chat or annotations channel from the connection's alias of the session or of the chat, and `seenBy` respells an envelope's action with it; `broadcast` sends that copy to the connection, whether it watches the held channel or an alias, and both replays do the same, while `replayable` keeps the held spelling.
A chat snapshot is respelled the same way in `answeredAs` when the connection knows its session by another name, including a peer chat the client named itself; the chat's own `state.resource` keeps the held name, as it did.
Test: `subagent-chat.test.ts`, `says the session's URIs inside an action in the spelling each client uses`: a creator on `ahp-session:/ask` and a client on `fake:/ask` each get `session/chatAdded` (`summary.resource`, `summary.origin.chat`), `session/inputNeededSet` (`request.chat`) and `chat/toolCallStart` (`_meta.subagentChatUri`) in their own spelling.
With the respelling taken out of `broadcast`, it fails, and so do existing `subagent-chat.test.ts` cases.
`conformance.test.ts` and `wire.test.ts` pass; `wire.test.ts` first caught `spelledFor` adding `chat` and `defaultChat` keys with no value where there were none, which it no longer does.
A `reconnect` replay now reaches the connection in its own spelling too: an action on a session or chat channel it knows by an alias goes out under that alias, respelled by `seenBy`, and any other channel keeps the held name.
Test: `host.test.ts`, `replays what it missed on a reconnect in the creator's spelling`: a creator on `ahp-session:/<uuid>` forks a chat, and a reconnect from seq 0 replays every action under `ahp-session:/<uuid>` with no `claude:/<uuid>` inside; it failed first on the channel.
`automations.test.ts` `is resumed under it on reconnect, and replayed` is unchanged: its client subscribes `ahp-automations://catalog` and is replayed under `ahp-automations://`, which is the catalogue and not a session, so the session rule does not reach it.
After the review of 2026-09-30, `spelledTo` is folded into `seenBy`, which now rewrites a root envelope as before and respells a session, chat or annotations envelope for a connection with an alias; `broadcast`, the `subscribe` replay and the `reconnect` replay each call `seenBy` alone, so its comment that it is the one place an envelope is rewritten for a connection is true.
The `reconnect` replay is one `flatMap` over `replayable` that takes the alias from `resumed` once, without an unreachable fallback.
`respelledIn` respells only a string under a key in `URI_KEYS` (every field the protocol types `URI`, `uriTemplate`, and `_meta.subagentChatUri`) or in an array under one, so a message, a tool's input or output or a title that names the session stays as written.
Test: `host.test.ts` `replays a chat and a pending approval on a reconnect in the creator's spelling, and leaves text alone`: a reconnect from seq 0 with the session and its default chat under their `ahp-session:` names replays `chat/turnStarted` under the chat's alias with its text `claude:/<uuid>/changeset/session is what changed` unchanged, and `session/inputNeededSet` with `request.chat` in the creator's spelling; it failed first on the text, which came back as `ahp-session:/<uuid>/...`.
