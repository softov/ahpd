---
title: An ended nested session refuses what follows with the reason
status: todo
depends: [task-07-the-inner-hosts-pipes-cannot-crash-the-daemon.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/nested.ts#L253-L285](../../../../packages/sdk/src/nested.ts#L253-L285) - `deliver` drops silently once `fail` has set `ended`"
  - "[code://packages/sdk/src/host/chatactions.ts#L220-L264](../../../../packages/sdk/src/host/chatactions.ts#L220-L264) - where a client action reaches a held session, before the switch on `type` at :264"
  - "[code://packages/sdk/src/host.ts#L605-L615](../../../../packages/sdk/src/host.ts#L605-L615) - `refuse`"
---

## Objective

After the inner host has ended, every client action on the nested session, a new turn included, is refused with the sentence the session ended with.

## Files

- `UPDATE: packages/sdk/src/types/session.ts:225-543` - `Session` gains an optional member that answers the sentence a session ended with, or nothing while it runs.
- `UPDATE: packages/sdk/src/nested.ts:270-285` - `fail` keeps the sentence; the new member answers it.
- `UPDATE: packages/sdk/src/host/chatactions.ts:264` - before the switch on `type`, a held session that answers a sentence is refused with it through `refuse`.

## Steps

1. Name the member for what it answers (for example `ended(): string | undefined`), with a doc comment saying what it is, not why it was added.
2. In the host, refuse every client dispatch to that session's session and chat channels with the sentence; a draft included, since nothing will read it.
3. Leave `deliver`'s guard as the last line of defence for a call that does not come through the host.

## Validation

- `packages/sdk/test/nested-process.test.ts`: a real inner host killed with SIGKILL, then a client `chat/turnStarted` for `t2` through the outer host, is answered with a refusal carrying the sentence; today nothing answers it.
- `packages/sdk/test/nested-proxy.test.ts`: `session.begin` after a scripted host's crash emits nothing new, and the session's new member answers the sentence.
- `node_modules/.bin/vitest run packages/sdk/test/nested-process.test.ts packages/sdk/test/nested-proxy.test.ts` passes.

## Resume
