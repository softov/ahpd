---
title: The session context tells each call and each cut reply - implemented
date: 2026-11-11
refs:
  - git://9d9f40bec
  - "[code://packages/sdk/src/tools/session.ts](../../../../packages/sdk/src/tools/session.ts) - the four fields, the page of a cut reply, and each call's status"
  - "[code://packages/sdk/src/types/host.ts](../../../../packages/sdk/src/types/host.ts) - `context` also answers the chat's pending messages"
  - "[code://packages/sdk/src/host/tooling.ts](../../../../packages/sdk/src/host/tooling.ts) - `contextOf` collects the steering and queued messages"
  - "[code://packages/sdk/test/sessiontools.test.ts](../../../../packages/sdk/test/sessiontools.test.ts) - the cases for the fields and the call objects"
---

`get_session_context` now says which replies were cut, and reads one whole page by page. It lists the caller's own pending messages and names a chat's other agent. It describes each tool call with its status.

## What was built

- [`code://packages/sdk/src/tools/session.ts`](../../../../packages/sdk/src/tools/session.ts) - `serializeContext` answers `assistantTruncated`, `responseTurnId`, `messagesSentByMe` and `harness`. `get_session_context` takes `responseTurnId` and `responseOffset` and answers one page of 8000 characters with `responseLength`, `nextResponseOffset` and `truncated`. `serializeCall` answers `{ name, status }`, with `ok`, `error` or `reason`.
- [`code://packages/sdk/src/types/host.ts`](../../../../packages/sdk/src/types/host.ts) - `context` answers `pendingMessages`, each with its kind and its id and message.
- [`code://packages/sdk/src/host/tooling.ts`](../../../../packages/sdk/src/host/tooling.ts) - `contextOf` collects the chat's steering and queued messages from the run state.
- [`code://packages/sdk/test/sessiontools.test.ts`](../../../../packages/sdk/test/sessiontools.test.ts) - the cases in both tasks' *Validation*.
- [`code://docs/sdk/TOOLS.md`](../../../../docs/sdk/TOOLS.md) - the fields, the page, and a call's status at `digest` and `full`.
- [`code://docs/updates/v0_15.md`](../../../../docs/updates/v0_15.md) - the *Upgrading* bullet on a call read as an object.
- [`code://UPSTREAM.md`](../../../../UPSTREAM.md) - the item on `get_session_context` names the pending messages, the cut reply and the chat's agent.

## Verified

- `pnpm exec tsc -p tsconfig.json --noEmit` is clean.
- `pnpm -s schema` generated 508 definitions from 506 exported types and 633 closed objects.
- The sdk and server vitest suites did not run. The mandated `flock /home/softov/tmp/ahpd-test/vitest.lock` prefix is denied by this session's permission mode, so a suite could not take the shared lock.

## Departures from the plan

- None.

## Left for later

- The `packages/sdk` and `packages/server` suites, each under the shared lock, with `packages/sdk/test/fixtures/wire.jsonl` restored after each run.
