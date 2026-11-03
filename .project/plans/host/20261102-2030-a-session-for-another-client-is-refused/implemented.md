---
title: A session for another client is refused - implemented
date: 2026-11-02
refs:
  - git://d32cfe51 - the change
  - "[code://packages/sdk/src/host/sessionmethods.ts](../../../../packages/sdk/src/host/sessionmethods.ts)"
---

A `createSession` whose `activeClient` names a `clientId` other than the connection's is refused with `-32602`, before anything is claimed or made.
A creator naming its own id, or none, is held in the session as it was.

## What was built

- [`code://packages/sdk/src/host/sessionmethods.ts`](../../../../packages/sdk/src/host/sessionmethods.ts) - the creator's id checked after the provider's checks, and the entry held as the creator sent it.
- [`code://docs/sdk/AHP.md`](../../../../docs/sdk/AHP.md) - the `createSession` row.

## Verified

- The changed presence case fails on `89ebe4d5`'s source, the request resolving, and passes with the change.
- The eleven files that create a session with a creator's entry pass.
- `pnpm run typecheck` and `pnpm run boundary` report no errors.

## Departures from the plan

- The plan refused an entry with no `clientId` too, as the reference host's comparison does.
- The task takes the connection's id for it, as a set's entry here takes it, and refuses an entry naming another id alone.
- A creator's entry with no `clientId` is what plan `20261102-1435-an-active-client-keeps-the-tools-it-sent` holds as sent.

## Left for later

- Left as it is: an entry with no `clientId` takes the connection's; VS Code's host refuses it ([protocolServerHandler.ts#L2211](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/protocolServerHandler.ts#L2211)).
