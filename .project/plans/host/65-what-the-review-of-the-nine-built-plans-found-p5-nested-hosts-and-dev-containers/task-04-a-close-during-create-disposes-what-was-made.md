---
title: A close during create disposes what was made
status: done
depends: [task-01-a-restart-waits-for-the-old-inner-host.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/nested.ts#L790-L809](../../../../packages/sdk/src/nested.ts#L790-L809) - `make`, which refuses to ask once the session is closed and keeps the request it made"
  - "[code://packages/sdk/src/nested.ts#L1043-L1069](../../../../packages/sdk/src/nested.ts#L1043-L1069) - `close`, which waits for a create in flight on a removal and disposes what it made"
  - "[code://packages/sdk/test/nested-proxy.test.ts#L119-L145](../../../../packages/sdk/test/nested-proxy.test.ts#L119-L145) - `holdingCreate`, an inner host whose answer to the create is held"
  - "[code://packages/sdk/test/nested-proxy.test.ts#L429-L444](../../../../packages/sdk/test/nested-proxy.test.ts#L429-L444) - the case"
---

## Objective

A nested session removed while its inner `createSession` is in flight leaves no session inside: the close waits for the create to settle and disposes what it made.

## Files

- `UPDATE: packages/sdk/src/nested.ts:761-768,971-974` - `close` on a removal waits for a create in flight and disposes the session if it was made; today `up` is false until `ready`, so the host is shut down with no dispose and an inner session the create already wrote stays in the machine's store.
- `UPDATE: packages/sdk/test/nested-proxy.test.ts` - the case below, which the task names in `nested-process.test.ts`; the Resume says why it is here.

## Steps

1. Failing case first: an inner host whose `createSession` answers after a delay; dispose the outer session during it. Today the inner store holds the session afterwards; after, it does not.

## Validation

- The case fails on `e1c4ccc` and passes after.
- `pnpm exec vitest run packages/sdk/test/nested-*.test.ts`.

## Resume

Implemented. `make` keeps the request it sent in `making`, and returns without asking when the session is already closed. `close` reads `making` the moment it is called: on a removal with a create in flight it awaits that request and folds the answer into `up`, so a create that succeeded is disposed like any other ready session and a create that failed is a session that was never made, which is skipped and the host stopped as it was. `ready` is untouched, so nothing else about the start-up changes.

The case failed first as `expected false to be true` on `inner.messages.some((message) => message.method === 'disposeSession')` - nothing was sent, which is the whole of the defect: the close shut the client down with the create unanswered and the machine's store left holding it. It passes now with the same case, a `disposeSession` for the inner session and no `session/creationFailed`.

The case lives in `nested-proxy.test.ts` rather than the `nested-process.test.ts` the task names. The window it needs is the create being unanswered, and neither half of that is reachable with a real child: the fixture writes its store only after a completed turn, so a session made and not run leaves no file to read, and a real `ahpd` cannot be told to hold one answer. The proxy's own test has the inner host in process, behind a `stdout` the case can wrap, so `holdingCreate` holds the one frame answering the create the proxy wrote - matched by the id of the create in `inner.messages` - and `release` sends it once the removal is in. That also makes the assertion the sharper one: not a file the fixture happens to write, but the `disposeSession` the removal is supposed to send.

One consequence is worth naming: with the fix the start-up carries on past the create into its subscribe and its `ready`, racing the close that is disposing behind it. A subscribe that loses that race throws into `bringUp`'s catch, and `fail` returns at once once `closed` is set, so it is a log line and not a `session/creationFailed` for a session that is by then gone. The case asserts that half too.

Gates: `npx tsc -b` clean, `npx vitest run packages/sdk/test/nested-proxy.test.ts packages/sdk/test/nested-process.test.ts` 49 passed, `npx vitest run packages/sdk/test` 106 files and 1493 tests passed.
