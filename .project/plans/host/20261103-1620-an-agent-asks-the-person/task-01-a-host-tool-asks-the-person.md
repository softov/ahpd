---
title: A host tool asks the person
status: todo
depends: []
layer: "@ahpd/sdk host"
refs:
  - "[code://packages/sdk/src/types/host.ts#L1137-L1318](../../../../packages/sdk/src/types/host.ts#L1137-L1318) - `ToolCall`"
  - "[code://packages/sdk/src/host/tooling.ts#L1706](../../../../packages/sdk/src/host/tooling.ts#L1706) - `toolContext`, which builds a `ToolCall`"
  - "[code://packages/sdk/src/host/chatactions.ts#L1804-L1860](../../../../packages/sdk/src/host/chatactions.ts#L1804-L1860) - `chat/inputCompleted`"
  - "[code://packages/agent-claude/src/session/asking.ts#L346-L357](../../../../packages/agent-claude/src/session/asking.ts#L346-L357) - the request a backend sends, the shape to copy"
---

## Objective

`ToolCall.ask(questions)` sends `chat/inputRequested` on the tool's chat and waits for the person's answer.
`chat/inputCompleted` for a request the host sent settles that request and never reaches the backend.
A stop of the turn cancels a request that waits.

## Files

- `UPDATE: packages/sdk/src/types/host.ts:1137-1318` - `ask` on `ToolCall`, and the answer type.
- `UPDATE: packages/sdk/src/host/tooling.ts:1706` - `toolContext` builds `ask` on the host's held requests.
- `UPDATE: packages/sdk/src/host/chatactions.ts:1804-1860` - a request the host holds is settled before the backend is asked.
- `CREATE: packages/sdk/src/host/asking.ts` - the requests the host holds, by id, with their settle.
- `CREATE: packages/sdk/test/host-asking.test.ts` - the cases.

## Steps

1. Write `asking.ts`: hold, settle and cancel a request by id.
2. Build each request id with a host prefix, so it never equals a backend's id.
3. Add `ask` to `ToolCall`, and build it in `toolContext`.
4. Send `chat/inputRequested` with the questions on the tool's chat.
5. Settle a held request in `chat/inputCompleted`, and do not call `session.answer` for it.
6. Cancel the held requests of a turn when the turn ends or stops.
7. Write the tests.

## Validation

- `host-asking.test.ts`: `ask` sends `chat/inputRequested`, and the client's answer returns from `ask`.
- `host-asking.test.ts`: a decline and a cancel return as such.
- `host-asking.test.ts`: the backend's `answer` is not called for the host's request.
- `host-asking.test.ts`: a stop of the turn cancels the request.
- `pnpm --filter @ahpd/sdk test` passes.

## Resume
