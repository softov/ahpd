---
title: Host and client tools reach pi - implemented
date: 2026-09-28
refs:
  - git://e1c5e73
  - "[code://packages/agent-pi/src/tools.ts](../../../../packages/agent-pi/src/tools.ts) - `toPiTool`, a `BoundTool` as a pi tool"
  - "[code://packages/agent-pi/src/session.ts](../../../../packages/agent-pi/src/session.ts) - the client wait, `setTools` and the rebuild"
---

The tools the host contributes and the tools a connected client provides are offered to pi's model; a host tool runs in the host, and a call to a client's tool is reported against that client and waits for its answer.

## What was built

- [`code://packages/agent-pi/src/tools.ts`](../../../../packages/agent-pi/src/tools.ts) - `toPiTool` keeps the name, title and input schema, drops a name pi already owns with a warning, races a host tool's `run` against pi's abort, and rejects a client's `ok: false`.
- [`code://packages/agent-pi/src/session.ts`](../../../../packages/agent-pi/src/session.ts) - `byClient` and `ranByClient` for client calls, with `toolCallOwner`, `completeToolCall` and `clientGone` on the `Session`; `setTools` marks the backend stale and `begin` rebuilds it on the same session file with the model and thinking level it was on; a failed rebuild fails only its turn.
- [`code://packages/agent-pi/src/mapping.ts`](../../../../packages/agent-pi/src/mapping.ts) - `contributor: { kind: 'client', clientId }` on a client call.
- [`code://packages/agent-pi/README.md`](../../../../packages/agent-pi/README.md) - a bullet on what the host's and a client's tools do.

## Verified

- `packages/agent-pi/test/agent-pi.test.ts` covers the conversion, a client wait, a refusal, a gone client, release on cancel, the contributor, a change before, after and during a turn, and a rebuild that keeps the model.
- Task 07 removed each guarded line in turn and saw its case fail.
- `vitest run packages/agent-pi` 91 tests; `pnpm test`, `pnpm typecheck` and `pnpm boundary` green.
- Reviewed by Softov on 2026-09-27 (tasks 01 to 04) and 2026-09-28 (tasks 05 to 07).

## Departures from the plan

- Tasks 05 to 07 were added in review: tools announced while pi opens, a rebuild that keeps the session, and tests that fail without their fix.

## Left for later

- `pnpm wire` against a captured session was not run here; pi/09 task 09 later validated a capture.
