---
title: An active client keeps the tools it sent - implemented
date: 2026-11-02
refs:
  - git://89c19e7c - the change
  - "[code://packages/sdk/src/host/actions.ts](../../../../packages/sdk/src/host/actions.ts)"
  - "[code://packages/sdk/src/host/sessionmethods.ts](../../../../packages/sdk/src/host/sessionmethods.ts)"
---

A client's `session/activeClientSet` entry, and the creator's entry in `createSession`, are held, echoed and shown as the client sent them.
An entry with no `tools` stays with no `tools`, and its client provides no tool to the session's chats.

## What was built

- [`code://packages/sdk/src/host/actions.ts`](../../../../packages/sdk/src/host/actions.ts) - a set's entry is the client's fields under the connection's `clientId`.
- [`code://packages/sdk/src/host/sessionmethods.ts`](../../../../packages/sdk/src/host/sessionmethods.ts) - the creator's entry the same.
- [`code://packages/sdk/test/presence.test.ts`](../../../../packages/sdk/test/presence.test.ts) - a set and a creator's entry with no `tools`, held as sent.
- [`code://docs/sdk/AHP.md`](../../../../docs/sdk/AHP.md) - the `session/activeClientSet` row.

## Verified

- On `89ebe4d5`'s `actions.ts` and `sessionmethods.ts` both new cases fail: each entry carried `tools: []`.
- With `89c19e7c` the presence, host-tools, host-catalogue, client-plugins-session, host-names, wire and nested-proxy files pass, and agent-acp's two client tool files, 359 tests.
- The chat in the first case is offered the other client's tool alone, as on the base.
- `pnpm run typecheck` and `pnpm run boundary` report no errors.

## Departures from the plan

- None.

## Left for later

- Left as it is: a `createSession` whose `activeClient` names another `clientId` takes the connection's id in its place.
- VS Code's host refuses that request ([protocolServerHandler.ts#L2209-L2211](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/protocolServerHandler.ts#L2209-L2211)), and every VS Code window sends its own id.
- The protocol says the two MUST match and names no answer to a mismatch ([commands.ts#L77-L85](https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-session/commands.ts#L77-L85)).
