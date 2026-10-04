---
title: A summary that did not change is not sent
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/catalogue.ts#L219-L240](../../../../packages/sdk/src/host/catalogue.ts#L219-L240) - `summaryMoved`, where the check goes"
  - "[code://packages/sdk/src/host/catalogue.ts#L193-L197](../../../../packages/sdk/src/host/catalogue.ts#L193-L197) - `sessionAdded`, which clears it"
  - "[code://packages/sdk/src/host/lifecycle.ts#L369](../../../../packages/sdk/src/host/lifecycle.ts#L369) - the dispose that removes a session"
  - "[code://packages/sdk/test/host-catalogue.test.ts](../../../../packages/sdk/test/host-catalogue.test.ts) - where the catalogue's tests live"
---

## Objective

`summaryMoved` sends `root/sessionSummaryChanged` only when the `changes` it built differ from the last ones it sent for that session, so a build session no longer floods every client with copies of the same row.

## Files

- `UPDATE: packages/sdk/src/host/catalogue.ts:192-240` - a `lastSent` map beside `summaryMoved`; `summaryMoved` compares and records; `sessionAdded` clears; a new `forgetSent(uri)` on `Catalogue`.
- `UPDATE: packages/sdk/src/host/lifecycle.ts:369` - calls `forgetSent(uri)` where `root/sessionRemoved` is broadcast.
- `UPDATE: packages/sdk/test/host-catalogue.test.ts` - the cases below.

## Steps

1. In `createCatalogue`, keep `lastSent: Map<string, string>`, the serialised `changes` last sent per session URI.
2. In `summaryMoved`, serialise `changes` with `JSON.stringify` once it is built; when it equals `lastSent.get(uri)`, return without broadcasting; otherwise record it and broadcast as today.
3. In `sessionAdded`, `lastSent.delete(uri)` before broadcasting.
4. Add `forgetSent(uri)` to the `Catalogue` interface and its return, and call it from `lifecycle.ts` beside the `root/sessionRemoved` broadcast.
5. Leave the five callers (`facts.ts`, `spawn.ts`, `tooling.ts`, `actions.ts`, `chatactions.ts`) as they are: the check is in the one place they all go through.

## Validation

- `host-catalogue.test.ts`: N `summaryMoved` calls on an unchanged session send one `root/sessionSummaryChanged`; a change of `activity` or `title` sends one more; a listed row whose status flag is set sends once and not on a repeat; a session disposed and then added again under the same URI sends on its first move.
- `pnpm exec tsc --noEmit`, `pnpm test`.

## Resume
