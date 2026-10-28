---
title: A new session is held as `ahp-session:`
status: todo
depends: [task-01-the-store-keeps-a-sessions-uri.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/sessionmethods.ts#L927-L953](../../../../packages/sdk/src/host/sessionmethods.ts#L927-L953) - `createSession`, which makes `${provider}:/${idOf(given)}` and claims both names"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L159](../../../../packages/sdk/src/host/sessionmethods.ts#L159) - `movedTo`, the session made for a moved chat"
  - "[code://packages/sdk/src/host/changesets.ts#L270](../../../../packages/sdk/src/host/changesets.ts#L270) - `askModel`"
  - "[code://packages/sdk/src/host/automations.ts#L704-L707](../../../../packages/sdk/src/host/automations.ts#L704-L707) - `beginSession`"
  - "[code://packages/sdk/src/host/tooling.ts#L1703-L1705](../../../../packages/sdk/src/host/tooling.ts#L1703-L1705) - the session tool's `create`"
  - "[code://packages/sdk/src/sessions/nested.ts#L904-L945](../../../../packages/sdk/src/sessions/nested.ts#L904-L945) - the nested proxy's `createSession` in the host inside"
  - "[code://packages/sdk/src/host/spawn.ts#L574-L580](../../../../packages/sdk/src/host/spawn.ts#L574-L580) - `keepProvider`, where the held name is stored"
  - "[code://packages/sdk/src/sessions/catalog.ts#L85-L91](../../../../packages/sdk/src/sessions/catalog.ts#L85-L91) - `uriFor`, the one place that spells `ahp-session:/<id>`"
  - "[code://packages/sdk/test/host-names.test.ts#L74-L130](../../../../packages/sdk/test/host-names.test.ts#L74-L130) - the cases that expect `claude:/<id>` for an `ahp-session:` create"
---

## Objective

A session that a client creates on `ahp-session:/<id>`, or on `<provider>:/<id>` with that provider, is held under that URI.
A session that a client creates on any other channel is held as `ahp-session:/<id>`, with the client's URI as an alias.
Every session that ahpd makes by itself is `ahp-session:/<uuid>`, and the held name is stored in its row.

## Files

- `UPDATE: packages/sdk/src/host/sessionmethods.ts:942` - `createSession` holds the session under the name the answers give, not `${provider}:/${idOf(given)}`.
- `UPDATE: packages/sdk/src/host/sessionmethods.ts:159` - `movedTo` names a new destination `uriFor(own)`.
- `UPDATE: packages/sdk/src/host/changesets.ts:270` - `askModel` names its session `uriFor(crypto.randomUUID())`.
- `UPDATE: packages/sdk/src/host/automations.ts:705-706` - `beginSession` names its session `uriFor(crypto.randomUUID())`, and the comment changes.
- `UPDATE: packages/sdk/src/host/tooling.ts:1704-1705` - the session tool's `create` names its session `uriFor(crypto.randomUUID())`, and the comment changes.
- `UPDATE: packages/sdk/src/sessions/nested.ts:914` - the proxy creates `uriFor(sessionId)` in the host inside, and keeps `provider` in the request.
- `UPDATE: packages/sdk/src/host/spawn.ts:574-580` - `keepProvider` stores the held name as `uri` under the host's id when the row has none.
- `UPDATE: packages/sdk/src/host/spawn.ts:1707-1708` - the comment says the held name is the session's own, not its provider's.
- `UPDATE: packages/sdk/test/host-names.test.ts` - the create cases expect the new names.
- `UPDATE: packages/sdk/test/nested-start.test.ts` - the proxy creates `ahp-session:/<id>`.

## Steps

1. In `createSession`, keep `given` as the held name when its scheme is `ahp-session`.
2. Keep `given` as the held name when its scheme is the provider the request names.
3. Otherwise hold the session as `uriFor(idOf(given))`, and claim `given` as an alias.
4. Change `movedTo`, `askModel`, `beginSession` and the session tool's `create` to name new sessions with `uriFor`.
5. Change the nested proxy to create and subscribe `uriFor(sessionId)`.
6. In `keepProvider`, call `kept.setUri?.(idOf(uri), uri)` if the row has no `uri`.
7. Do not store a `uri` under the backend's own id.
8. Change each test that expects a `<provider>:/<id>` name for a new session to expect the new name.

## Validation

- Test in `packages/sdk/test/host-names.test.ts` that `listSessions` and `root/sessionAdded` give `ahp-session:/<id>` for a create on that URI.
- Test that `listSessions` gives `claude:/<id>` for a create on `claude:/<id>` with provider `claude`.
- Test that `listSessions` gives `ahp-session:/<id>` for a create on `pi:/<id>` with provider `claude`.
- Test that a subscribe on `pi:/<id>` still opens that session.
- Test that the row of each new session holds its held name as `uri`.
- Test in `packages/sdk/test/nested-start.test.ts` that the proxy sends `channel: ahp-session:/<id>` and `provider`.
- `pnpm boundary`, `pnpm typecheck` and `pnpm test` pass.

## Resume
