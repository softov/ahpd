---
title: The host answers one URI, and an older window what it can address
status: done
depends: []
layer: host
refs:
  - "[code://packages/sdk/src/host/routing.ts](../../../../packages/sdk/src/host/routing.ts) - the resolution of a URI, and what a connection may see"
  - "[code://packages/sdk/src/host.ts#L596-L739](../../../../packages/sdk/src/host.ts#L596-L739) - `broadcast` and `seenBy`"
  - "[code://packages/sdk/src/host/handshake.ts#L256-L640](../../../../packages/sdk/src/host/handshake.ts#L256-L640) - `initialize` and `reconnect`"
  - "[code://packages/sdk/src/host/sessionmethods.ts](../../../../packages/sdk/src/host/sessionmethods.ts) - `subscribe`, `listSessions`, `createSession` and `moveChat`"
  - "[code://packages/sdk/test/host-names.test.ts](../../../../packages/sdk/test/host-names.test.ts) - the cases for a session's other spellings"
---

## Objective

A session and a chat are answered under the URI they are held by, and under no other.
An older VS Code window is marked at `initialize` and `reconnect`, and shown only the sessions and chats it can address.
A session a client creates is held under the channel it named.
A session a tool makes for an older window's turn is named in its provider's scheme.
A default chat URI is its session's only while the session's record agrees.

## Files

- `UPDATE: packages/sdk/src/types/host.ts` - the connection's two marks; `aliases` holds the host channels' other spellings alone.
- `UPDATE: packages/sdk/src/host/routing.ts` - `heldAs`, `sessionOfChat`, `meantBy` and `answeredAs` resolve one URI; `visible` and its filters; the respelling goes.
- `UPDATE: packages/sdk/src/host/channels.ts` - `shapedSession`, the session a shaped chat URI names; `URI_KEYS` goes.
- `UPDATE: packages/sdk/src/host.ts` - `seenBy` and `broadcast` filter for an older window; the alias checks for a session go.
- `UPDATE: packages/sdk/src/host/handshake.ts` - the marks at `initialize` and `reconnect`; a first or resumed subscription an older window may not see.
- `UPDATE: packages/sdk/src/host/sessionmethods.ts` - `subscribe` refuses what a connection may not see; `listSessions` filters; `createSession` holds the named URI; `moveChat` refuses a hidden destination.
- `UPDATE: packages/sdk/src/host/snapshots.ts` - a chat seed reads its session from the record or the URI, and an unknown chat is not found.
- `UPDATE: packages/sdk/src/host/tooling.ts` - a tool's new session in the provider's scheme for an older window's turn.
- `UPDATE: packages/sdk/src/host/auth.ts` - a connection watches a session under its one URI.
- `UPDATE: packages/sdk/src/host/spawn.ts` - a chat title under the `ahp-session:` spelling of its URI, read without `respell`.
- `UPDATE: packages/sdk/src/host/context.ts` - the routing members that go.
- `UPDATE: packages/sdk/src/sessions/catalog.ts` - `uriFor` and `idOf` say what the id keys.
- `UPDATE: packages/sdk/test/host-names.test.ts` - the spelling cases become one URI, and the older window's cases join them.
- `UPDATE: packages/sdk/test/host-chats.test.ts` - a re-pointed default chat, and a chat named `ahp-chat:/<id>`.

## Steps

1. Add `legacySessionUris` and `legacyChatUris` to the connection, and set them at `initialize` from `clientInfo.name` and `_meta`.
2. Keep each client's `clientInfo.name` by its id, and set the marks at `reconnect` from it and the reconnect's `_meta`.
3. Make `heldAs` answer an unknown URI with that same URI.
4. Make `meantBy` resolve only the root and the automations catalogue.
5. Make `sessionOfChat` read a session only from a canonical default or worker URI.
6. Make `sessionOfChat` give a default chat's session only while the session's record agrees.
7. Remove `spelledFor`, `respelledIn` and `spellingOf`, and every respelling of a session's URIs.
8. Add `visible` and the chat filters, and call them where a session or a chat goes out.
9. Hold a created session under the channel the client named, with no alias claim.
10. Name a tool's new session `<provider>:/<uuid>` when an older window sent the running turn.
11. Refuse a move to a session the client may not see.
12. Read every caller of `sessionOfChat` again, so an opaque chat stays a chat.
13. Rewrite the spelling cases and add the older window's cases.

## Validation

- `packages/sdk/test/host-names.test.ts`: the older window's cases and the one-URI cases fail on `89ebe4d5` and pass after the change.
- `packages/sdk/test/host-chats.test.ts`: the default chat URI after a move of the default fails on `89ebe4d5` and passes after.
- The sdk test files pass.
- This task's *Resume* names each test file whose assertion moves with the behavior.
- `pnpm run typecheck` is clean.

## Resume

Done 2026-11-02 in `e4db65aa`.

- The older window's cases, the one-URI cases and the dispatch case of `host-names.test.ts` fail on `89ebe4d5` and pass.
- The test files whose assertions moved with the behavior, by what a session or a chat is named:
  - A default chat is named by `chatUriFor`, in `host-catalogue`, `sessions`, `wire`, `host-sessionconfig`, `host-snapshots`, `host-trust` and `host-local-turns`.
  - The same holds in `session-provider` and `claude-saved-output`.
  - It holds in the other packages' `agent-acp-ports`, `agent-cofold-*`, `agent-pi-*`, `bot-chat` and `computer-session`.
  - It holds in `plugin-connect`, `plugin-end-to-end` and the `plugin-connect` fixture.
  - A session is named by the URI it is held by, in `users-gate-sessions`, `users-gate-names`, `host-past-open`, `plugin-session-owner` and `host-catalogue-held`.
  - The same holds in the rest of the `sdk/test` files of the commit.
- `pnpm run typecheck`, `pnpm run boundary` and `pnpm run i18n` are clean, and the unit test set passes, 7481 tests.
