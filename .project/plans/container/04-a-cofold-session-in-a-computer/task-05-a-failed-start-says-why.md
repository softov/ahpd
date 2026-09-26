---
title: A nested start that fails says why
status: implemented
depends: [task-04-nested-instead-of-refused.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/computers.ts](../../../../packages/sdk/src/computers.ts) - where the proxy is started"
---

## Objective

A nested host that is missing, exits before `initialize`, has another protocol version, or cannot create its session ends the outer session with a sentence that carries the last lines of its stderr.

## Files

- `UPDATE: packages/sdk/src/nested.ts`

## Steps

1. A timeout on `initialize`, so a host that never answers is a sentence too.

## Validation

- One test per failure, each asserting the sentence.

## Resume

Implemented 2026-09-26.
`packages/sdk/src/nested.ts` keeps the inner host's last twelve stderr lines and every failure ends the outer session with one sentence carrying them: a start that could not be made, a process that exited before the session existed, a host that speaks another protocol version at `initialize`, and a `createSession` the inner host refused.
The timeout is `AhpClient`'s own `requestTimeoutMs`, set from `NestedOptions.timeoutMs` and defaulting to `ANSWER_TIMEOUT`, so a host that never answers `initialize` is a sentence rather than a wait.
A failure kills the process and emits `session/creationFailed` - and a `chat/error` for a turn that had started - so nothing hangs.
Validated by `test/nested-proxy.test.ts`, one case per failure, each asserting the sentence: ENOENT, an exit before `initialize` with its stderr, another protocol version, a refused `createSession`, and the `initialize` timeout.
