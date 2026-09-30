---
title: Every request answers to either name of a session
status: implemented
depends: [task-01-a-created-session-is-held-under-its-providers-name.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L7292-L7296](../../../../packages/sdk/src/host.ts#L7292-L7296) - `createChat`, which looks the session up by the exact string"
  - "[code://packages/sdk/src/host.ts#L7429-L7431](../../../../packages/sdk/src/host.ts#L7429-L7431) - `disposeSession`, which passes the exact string to `removeSession`"
  - "[code://packages/sdk/src/host.ts#L4003-L4006](../../../../packages/sdk/src/host.ts#L4003-L4006) - `removeSession`, `sessions.get(uri)`"
  - "[code://packages/sdk/src/host.ts#L6080-L6097](../../../../packages/sdk/src/host.ts#L6080-L6097) - `initialize`, whose `initialSubscriptions` call `snapshotOf` without `meantBy`"
  - "[code://packages/sdk/src/host.ts#L6228-L6240](../../../../packages/sdk/src/host.ts#L6228-L6240) - `reconnect`, which sets the alias but does not apply `spelledFor`"
  - "[code://packages/sdk/src/host.ts#L6306-L6347](../../../../packages/sdk/src/host.ts#L6306-L6347) - `subscribe`, the pattern the other three follow"
  - "[code://packages/sdk/src/host.ts#L9258-L9277](../../../../packages/sdk/src/host.ts#L9258-L9277) - `unsubscribe`"
---

## Objective

A client that created a session as `ahp-session:/<uuid>` can fork a chat in it, dispose it, name it in `initialSubscriptions` and `reconnect` to it, and is answered in that spelling each time.

## Files

- `UPDATE: packages/sdk/src/host.ts:7292-7296` - `createChat` resolves the session with `heldAs`.
- `UPDATE: packages/sdk/src/host.ts:7429-7431` - `disposeSession` resolves the channel with `heldAs` before `removeSession`; `root/sessionRemoved` still names the held name.
- `UPDATE: packages/sdk/src/host.ts:6080-6097` - `initialSubscriptions` go through `meantBy`, record the alias and apply `spelledFor`, as `subscribe` does.
- `UPDATE: packages/sdk/src/host.ts:6228-6240` - `reconnect` applies `spelledFor` to the snapshots it returns under an alias.
- `UPDATE: packages/sdk/src/host.ts:9258-9277` - check that `unsubscribe` under the alias drops the alias and the watch; change only if it does not.

## Steps

1. Factor the resolve-alias-respell sequence out of `subscribe` into one function, and call it from `subscribe`, `initialize` and `reconnect`.
2. Replace the exact lookups in `createChat` and `disposeSession` with `heldAs`.
3. Search `host.ts` for other `sessions.get(String(params.channel` and `sessions.get(uri)` on a client-supplied URI, and resolve them the same way; list any found in this task's Resume.

## Validation

- `host.test.ts`, a new `describe('a session asked for by the name its creator used')`: after `createSession` as `ahp-session:/<uuid>`, each of `createChat`, `disposeSession`, `initialize` with `initialSubscriptions: ["ahp-session:/<uuid>"]` and `reconnect` with that subscription succeeds, and every snapshot it returns is in the `ahp-session:` spelling.
- `pnpm -C packages/sdk test` passes.

## Resume

One `answeredAs(connection, channel, snapshot)` takes the resolve, alias and respell steps out of `subscribe`, and `subscribe`, `initialize`'s `initialSubscriptions` and `reconnect`'s snapshots call it; `createChat` and `disposeSession` resolve with `heldAs`.
`unsubscribe` already drops the alias and the watch; `leaves`, which it calls, looked the session up by the exact string, so it now resolves the name and says `session/activeClientRemoved` under the held one.
Other client-supplied lookups found by the step 3 search and resolved: `completions` (both the `@` and the `/` paths, through `meantBy`), `vscode/getAgentHostSessionStateFile`'s `chat` (through `chatOf`), `refuse`, which now answers under the connection's alias, and the changeset scans (`operationsMoved`, `contentMoved`, `watchedIn`, the cleanup in `removeSession`) through a new `changesetOf`, with `operationContext` and `statusOf` resolving the name too.
Tests: `host.test.ts`, `a session asked for by the name its creator used`: forks a chat in it, disposes it (`root/sessionRemoved` names `claude:/<uuid>`), answers it in `initialSubscriptions` and on a `reconnect` in the creator's spelling, and lets its creator go when it unsubscribes under its own name.
Each failed first: `No agent for session ahp-session:/<uuid>` for the two requests, no snapshot for the handshake, the held spelling on the reconnect, and no `activeClientRemoved` where the others watch.
A `reconnect` replay in the connection's spelling is task 03's, where its Resume says how.
Seen and not changed: the users gate (`capabilityFor`) asks `file:read`, not `session:read`, to subscribe to a session under any scheme other than `ahp-session:` or `ahp-chat:`, which now covers every listed session.
