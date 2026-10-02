---
title: A session records its owner
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L7853](../../../../packages/sdk/src/host.ts#L7853) - where `createSession` opens a session"
  - "[code://packages/sdk/src/sessions.ts#L80-L91](../../../../packages/sdk/src/sessions.ts#L80-L91) - the persisted shape"
---

## Objective

A session created by a signed-in person has `owner: 'user:<id>'`, kept by the session store and restored at start.

## Files

- `UPDATE: packages/sdk/src/host.ts:7853` - pass the connection's principal into `openSession`; store `owner` on the held session.
- `UPDATE: packages/sdk/src/sessions.ts:80-91` - `owner?: string` in `Saved`, written and read like `flags`.
- `UPDATE: packages/sdk/src/types/sessions.ts` - the `SessionStore` record gains `owner`, typed `Owner` from `types/usage.ts`.
- `UPDATE: packages/sdk/src/types/host.ts` - `hostName?: string` on `HostOptions`, the daemon's name in a root owner.
- `UPDATE: packages/server/src/commands/run.ts` - passes `hostName: hostname()`.

## Steps

1. No users directory: no owner. A root connection on a host with one: `root:<hostName>`, `root:host` when the option is absent.
2. A fork or a session made by a tool keeps the owner of the session it came from.
3. A `scope` change before the first turn is resolved against the session's owner, not whoever sends the change; with no owner, as today.

## Validation

- `packages/sdk/test/sessions.test.ts`: `owner` round-trips; a file without it loads.
- A host test: a session created over a signed-in connection has the owner, and after reload too; a root connection's session has `root:<hostName>`.
- `packages/sdk/test/session-scope.test.ts`: a scope change sent by another person resolves against the owner's memberships.
- `pnpm -F @ahpd/sdk test`.

## Resume

Implemented 2026-10-01.

`SessionStore` gained `owner(id)` / `setOwner(id, value)`, typed `Owner`, in both stores and in `Saved` as `owner?: string`; `fileSessions` writes it beside `scope` and reads it back only when it is one of the four typed references. `HostOptions.hostName` is the name a root owner takes, and the daemon passes `hostname()`. `openSession` takes a ninth argument, `by`, holding the owner and the principal behind it; `createSession` fills it from `ownerFor(connection)` and the tool path (`toolContext.create`) from the enclosing session's owner. A fork and a side chat are chats of the same session, so they keep it for free.

Step 3 needed one thing the plan does not name, and this is the choice made: `charge` resolves against a `Principal`, and the `Users` port has no way to ask for one by id - only `verify(token)` and `list()`. So the host keeps `principals`, a map from owner to the principal it has met, and `forWhom(owner, principal?)` rides the principal along into `openSession`. Keyed by owner rather than by session, so one person opening twenty sessions is one entry, and it is dropped only when the host goes. A `scope` change before the first turn then resolves against `principalFor(kept.owner(...))`, which is nothing for a `root:` owner and for a person this process never met - both fail closed through the refusal `beginOrRun` already knows how to give, exactly as `charge`'s own comment describes. A session with no owner at all is answered for as it always was.
