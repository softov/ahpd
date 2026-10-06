---
title: A nested session resumes the inner transcript by id
status: implemented
depends: [task-09-an-ended-nested-session-refuses-with-the-reason.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/nested.ts#L232](../../../../packages/sdk/src/nested.ts#L232) - `innerSession`, a random URI"
  - "[code://packages/sdk/src/nested.ts#L376-L381](../../../../packages/sdk/src/nested.ts#L376-L381) - the inner `createSession`"
  - "[code://packages/sdk/src/host/chatactions.ts#L139-L219](../../../../packages/sdk/src/host/chatactions.ts#L139-L219) - how a host resumes a session it is not running: a turn on its channel"
---

## Objective

A nested session resumed by the outer host continues the conversation the inner host holds under the same id, per [the decision](../../../decisions/a-nested-session-resumes-its-inner-transcript-by-id.md).

## Files

- `UPDATE: packages/sdk/src/nested.ts:232` - the inner session URI.
- `UPDATE: packages/sdk/src/nested.ts:376-387` - `createSession` and the subscriptions.
- `UPDATE: packages/sdk/src/nested.ts:412` - `agentId`.

## Steps

1. Name the inner session with the outer session's id (`start.resume` when it is set, the id in `start.uri` otherwise), so the id the outer host resumes is the one the inner host stored.
2. With `start.resume` set, skip `createSession`: subscribe to the inner session and let the first forwarded turn resume it on the inner host, which is how any ahpd resumes a session it is not running.
3. An inner host that does not know that id ends the session with a sentence that names the id and the machine.
4. Check that the outer host's `past(id)` finds a nested session after a restart; if the outer catalogue only reads the real backend's local store, stop and ask how a nested session is listed.

## Validation

- `packages/sdk/test/nested-process.test.ts`: one inner host serves a turn, the proxy is closed, a second proxy is created with `resume` set to that id against the same inner store, and its first turn sees the earlier turn in the inner session's snapshot; today it is a blank session.
- A resume against an inner host without the id ends with a sentence naming it.
- `node_modules/.bin/vitest run packages/sdk/test/nested-process.test.ts` passes.

## Resume

Implemented 2026-10-06.
The inner session is named `<inner provider>:/<outer id>`, since the inner host broadcasts a resumed session on that name; with `resume` set `createSession` is skipped, and a subscribe failure ends with "computer://X holds no session <id> to resume".
Step 4 was built after Softov's answer (2026-10-06, "Outer host keeps a record"): `SessionStore.nested` holds a `NestedRecord` (provider, machine, inner id, title, dates, folders) written when a nested session opens, kept in the session's own file, and the catalogue lists it and `past` opens it from there without asking the machine.
The store case and the three restart cases in `nested-proxy.test.ts` failed before.
Both process cases failed before the change.
