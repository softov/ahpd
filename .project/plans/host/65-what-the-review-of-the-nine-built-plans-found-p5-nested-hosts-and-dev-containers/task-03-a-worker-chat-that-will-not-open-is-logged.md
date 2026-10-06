---
title: A worker chat that will not open is logged, not thrown
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/nested.ts#L528-L582](../../../../packages/sdk/src/nested.ts#L528-L582) - `openWorker`: the subscribe's own catch, then everything after it inside one `try`"
  - "[code://packages/sdk/src/nested.ts#L599](../../../../packages/sdk/src/nested.ts#L599) - `void openWorker(...)`, which is why no caller holds the promise"
  - "[code://packages/sdk/test/nested-proxy.test.ts#L962-L997](../../../../packages/sdk/test/nested-proxy.test.ts#L962-L997) - the case, with the process's own `unhandledRejection` watched"
---

## Objective

Whatever opening an inner worker chat throws is logged with the chat's name and leaves the session running.

## Files

- `UPDATE: packages/sdk/src/nested.ts:528-582` - the body after the subscribe is inside a `try` that logs and returns; today a throw from `start.subagent(...)` or an `emit` rejects a promise started with `void`, and with no `unhandledRejection` handler anywhere that ends the daemon.
- `UPDATE: packages/sdk/test/nested-proxy.test.ts` - the case below.

## Steps

1. Failing case first: a `start.subagent` that throws, and an inner worker chat announced. Today the test sees an unhandled rejection; after, a log line naming the chat and no rejection.

## Validation

- The case fails on `e1c4ccc` and passes after.
- `pnpm exec vitest run packages/sdk/test/nested-*.test.ts`.

## Resume

Implemented. `openWorker` now has two catches rather than one: the subscribe keeps its own, which says the chat could not be read, and everything after it - the `subagent` seam, the parts written into the opened chat, the subscription that follows - sits inside a `try` whose catch logs `the worker chat <inner> could not be opened: <reason>` and returns. The subscribe is left outside it because its message is about reading, and a seam that throws is not a read that failed; the two sentences stay apart.

The throw was reproduced first as an unhandled rejection: the case watches `process.on('unhandledRejection')` for the length of one test, because installing a handler is what keeps Node from ending the process on the one a real daemon has none for. Seen failing at `expect(escaped).toEqual([])` with `[Error: the outer chat is gone]`, and passing after, with the run continuing to `chat/turnComplete` and no `session/creationFailed`.

The other two promises this file starts with `void` were read while fixing this one and are already held: `pump` ends the session with a sentence from its own catch, and `pumpRoot` swallows its subscription's end. `openWorker` was the only one whose tail ran outside anything.

Gates: `npx tsc -b` clean, `npx vitest run packages/sdk/test/nested-proxy.test.ts packages/sdk/test/nested-process.test.ts` 48 passed, `npx vitest run packages/sdk/test` 106 files and 1492 tests passed.
