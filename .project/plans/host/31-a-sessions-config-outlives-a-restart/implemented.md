---
title: A session's config outlives a restart, and a stored value the schema no longer offers falls back to the default - implemented
date: 2026-10-07
refs:
  - git://e33ebee
  - git://f1b3bd1
  - git://ca6adcb
  - git://693e06f
  - "[code://packages/sdk/src/host/sessionconfig.ts](../../../../packages/sdk/src/host/sessionconfig.ts)"
  - "[code://packages/sdk/src/host/chatactions.ts](../../../../packages/sdk/src/host/chatactions.ts)"
  - "[code://packages/sdk/src/configvalues.ts](../../../../packages/sdk/src/configvalues.ts)"
---

A session keeps the config it was created with and every accepted change after the daemon restarts.
The store holds JSON values, so an array or an object comes back as it went in.
On a resume or a browsed row, a declared value the schema refuses is dropped and the default is used, with one log line.
A key the schema does not declare is kept.

## What was built

- [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts) - `remember(key, value)` stores each key the backend accepted on a live `session/configChanged`.
- `remember` skips a peer chat's chat-scoped key, and writes nothing once the session it was made for is gone.
- The no-agent `session/configChanged` path stores values as they arrive, and refuses a channel that names no session with `<channel> is not a session here`.
- [`code://packages/sdk/src/host/sessionconfig.ts`](../../../../packages/sdk/src/host/sessionconfig.ts) - `storedConfig(owner, id)`, which a resume and a browsed row both read through.
- [`code://packages/sdk/src/configvalues.ts`](../../../../packages/sdk/src/configvalues.ts) - `accepts(property, value)`, the check on the JSON `type` and `enum`.
- [`code://packages/sdk/src/sessions.ts`](../../../../packages/sdk/src/sessions.ts) - `fileSessions` no longer loads an array as a session's config.
- Both tasks landed in `e33ebee`, in `host.ts`. host/48 p5 moved `storedConfig` to `host/sessionconfig.ts` in `f1b3bd1`, and p10 moved `remember` to `host/chatactions.ts` in `ca6adcb`.

## Verified

- [`code://packages/sdk/test/host-sessionconfig.test.ts`](../../../../packages/sdk/test/host-sessionconfig.test.ts), `a session's config across a restart`: created and live-changed values resume, and a stored `permissionMode: nope` resumes as `default`.
- The same block covers a refused change, a peer chat's key, a late answer after a dispose, and an undeclared key that is kept.
- [`code://packages/sdk/test/configvalues.test.ts`](../../../../packages/sdk/test/configvalues.test.ts) covers `accepts` on its own.
- [`code://packages/sdk/test/session-fixed-key.test.ts`](../../../../packages/sdk/test/session-fixed-key.test.ts) covers a change taken during a restart, and a config change that waited too long on the catalogue.
- Each host case failed first, as the tasks' Resume sections record.
- Softov reviewed both tasks on 2026-10-06.

## Departures from the plan

- A session placed in a `disposable:<profile>` machine stores its `computer://<id>`. A resume hands that machine back even if it is gone, because `accepts` does not check an `enumDynamic` key.
- host/57 removed the listing throttle (`LISTING_FRESH` and `pastAt`) in `693e06f`, so the plan's row on the 2 s listing window no longer holds.

## Left for later

- None.
