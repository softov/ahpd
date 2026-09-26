---
title: The proxy forwards asks, config, cancel and the end
status: implemented
depends: [task-02-the-proxy-forwards-turns.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/types/session.ts](../../../../packages/sdk/src/types/session.ts) - the `Session` methods the proxy implements"
---

## Objective

Tool confirmations, input answers, config changes, cancel, and dispose reach the inner session; the inner host's exit ends the outer session.

## Files

- `UPDATE: packages/sdk/src/nested.ts`

## Steps

1. One `Session` method at a time, each with its test.

## Validation

- `test/nested-proxy.test.ts`: a permission ask answered outside is seen inside; cancel stops the inner turn; killing the inner host ends the outer session.

## Resume

Implemented 2026-09-26.
Every `Session` method the proxy implements is one dispatch into the inner session: `begin`/`queue`/`steer` as `chat/turnStarted`/`chat/pendingMessageSet`, `cancel` as `chat/turnCancelled`, `confirm` as `chat/toolCallConfirmed`, `answer`/`setAnswer` as `chat/inputCompleted`/`chat/inputAnswerChanged`, `setConfig` as `session/configChanged`, `setCustomizationEnabled` as `session/customizationToggled`, `startMcpServer`/`stopMcpServer` as their own actions, and `close` as `disposeSession` followed by the client's shutdown and a `SIGTERM`.
The inner host's exit is the outer session's end: an exit after the session started emits `session/creationFailed` with the exit code and the last lines of stderr, and a turn that was running is failed too.
Validated by `test/nested-proxy.test.ts`: a permission ask emitted inside comes out and `confirm` reaches the inner session's own `confirm`; cancel stops the inner turn and no `chat/turnComplete` follows; killing the inner host ends the outer session with what it last said.
