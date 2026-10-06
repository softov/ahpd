---
title: A session the inner host does not hold is created, not resumed
status: done
depends: [task-01-a-restart-waits-for-the-old-inner-host.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/nested.ts#L772-L803](../../../../packages/sdk/src/nested.ts#L772-L803) - the session made inside, and the resume whose refusal is answered with one"
  - "[code://packages/sdk/src/nested.ts#L84](../../../../packages/sdk/src/nested.ts#L84) - `NO_AGENT`, the code the inner host refuses an unheld session with"
  - "[code://packages/sdk/src/nested.ts#L847](../../../../packages/sdk/src/nested.ts#L847) - `agentId: () => sessionId`, which is set from the first breath"
  - "[code://packages/sdk/src/host/lifecycle.ts#L435-L437](../../../../packages/sdk/src/host/lifecycle.ts#L435-L437) - a restart resumes whenever `agentId()` is set"
  - "[code://packages/sdk/test/nested-process.test.ts](../../../../packages/sdk/test/nested-process.test.ts) - the new case, and the one from container/04 whose sentence this replaces"
---

## Objective

A nested session the inner host does not hold is created there, whether or not the outer host asked to resume it; one it holds is resumed.

## Files

- `UPDATE: packages/sdk/src/nested.ts:772-803` - the create moved into `make`, called when there is no resume and again when a resume is refused with `NO_AGENT`; today `agentId()` is the session id from the start, so adding a directory before the first turn restarts with `resume` set, `createSession` is skipped, and an inner host that never persisted the session refuses with "holds no session to resume".
- `UPDATE: packages/sdk/src/nested.ts:84` - `NO_AGENT`, the protocol's `No agent for session` code, named once.
- `UPDATE: packages/sdk/test/nested-process.test.ts` - the case below, and the container/04 case that asserted the refusal.

## Steps

1. Failing case first: create a nested session, add a directory before any turn, then send a turn. Today the session ends with "holds no session to resume"; after, the turn runs.
2. A session with a turn, restarted, is still resumed with its turns (task 01's case).
3. A proxy-level resume with no transcript behind it makes the session under that id and runs a turn (the container/04 case, rewritten).

## Validation

- The case in step 1 fails on `e1c4ccc` and passes after.
- `pnpm exec vitest run packages/sdk/test/nested-*.test.ts`.

## Resume

Implemented. `createSession` moved into `make`, which the resume path now calls too: the subscribe is attempted as before, and when the inner host answers `-32001` - `No agent for session` - the session is made there and the subscribe is made again. Any other refusal, and a `-32001` on a path that was not a resume, is raised as it came. A line is logged when it happens, because a machine whose transcript has gone takes the conversation with it and this is the only place that says so.

The refusal is the answer to the only question that matters - will the inner host serve this session - so it is asked by subscribing rather than by listing the inner catalogue first, which the plan's row left open. `listSessions` was the other candidate and was turned down on two counts: it costs a listing of the machine's transcripts on every restart, and its rows come from the backends' `list()`, which is not quite the set `past()` can read - a session the catalogue leaves out but the host would serve would be created over, which is the loss the decision against copying transcripts exists to avoid. `-32001` is read the way `commands/usage.ts` already reads a daemon's `-32009`, with `instanceof RpcError` from the protocol client and the number named as `NO_AGENT` beside `ROOT`.

Step 1 was seen failing first at `expect(served.on(served.uri).filter(...creationFailed)).toEqual([])`, the session having emitted `session/creationFailed` "cofold could not start a host inside computer://box: computer://box holds no session nested-outer to resume (RPC error -32001: No agent for session cofold:/nested-outer)" and the chat a `chat/error`. Step 2 is task 01's case and passes unchanged: the second inner host still finds the transcript the first kept and resumes it.

The container/04 case `a resume the inner host has no transcript for ends with a sentence naming the id` asserted exactly the behaviour this task replaces, so it was rewritten as `a resume the inner host has no transcript for makes the session there`: no `session/creationFailed`, a turn that completes, `agentId()` still the resumed id, and the inner host's own store holding the turn under `never-ran-here`. That case and the one this file added are the two ends of the same rule - one through the outer host, one at the proxy - and the sentence "holds no session <id> to resume" no longer exists anywhere.

Gates: `npx tsc -b` clean, `npx vitest run packages/sdk/test/nested-process.test.ts` 12 passed, `npx vitest run packages/sdk/test/nested-proxy.test.ts` 35 passed, `npx vitest run packages/sdk/test` 106 files and 1491 tests passed.
