---
title: The inner host's pipes cannot crash the daemon
status: implemented
depends: [task-06-docs.md]
layer: "sdk | test"
refs:
  - "[code://packages/sdk/src/nested.ts#L138-L203](../../../../packages/sdk/src/nested.ts#L138-L203) - `stdioTransport`, with no `error` listener on stdin and the end taken from `exit`"
  - "[code://packages/sdk/test/nested-proxy.test.ts#L56-L130](../../../../packages/sdk/test/nested-proxy.test.ts#L56-L130) - the in-memory fakes, which cannot raise EPIPE or reorder `exit` and stdout"
  - "[code://packages/server/test/fixtures/plugin-echo/index.ts](../../../../packages/server/test/fixtures/plugin-echo/index.ts) - the echo plugin a real inner host can load"
---

## Objective

A nested host that dies at any moment, or closes its stdin, ends the outer session with a sentence and never throws in the outer daemon, and that is proved against a real child process.

## Files

- `UPDATE: packages/sdk/src/nested.ts:173-190` - the `exit` listener and `send`; stdin has no `error` listener today.
- `CREATE: packages/sdk/test/fixtures/plugin-nested-echo/index.ts` and `package.json`, after [`code://packages/server/test/fixtures/plugin-echo`](../../../../packages/server/test/fixtures/plugin-echo) - the echo backend under provider `cofold`, its `pace` read from the `PACE` environment variable.
- `CREATE: packages/sdk/test/nested-process.test.ts` - the proxy against real child processes.

## Steps

1. In `stdioTransport`, listen for `error` on `host.stdin` and treat it as the end, with the error's message as the reason, so a write to a dead pipe is a sentence and not an uncaught `EPIPE`.
2. Take the end from `close` instead of `exit`, so every stdout line the process wrote is delivered before the session ends.
3. Carry the signal into the sentence: `(code, signal)` from `close`, and a process killed by a signal says `it was killed by SIGKILL` rather than an empty reason.
4. Widen `NestedHost` (nested.ts:47) with whatever step 1 and step 2 need, and keep the in-memory fakes in `packages/sdk/test/nested-proxy.test.ts` compiling.
5. In the new test, start the inner host as `process.execPath` with `--conditions development --import ./scripts/dev.mjs packages/server/src/main.ts --stdio --plugin ./packages/sdk/test/fixtures/plugin-nested-echo`, through `NestedOptions.start`, with an explicit env of `PATH`, `HOME` and the XDG directories only, `HOME` and the XDG directories pointed at a temporary directory; never spread `process.env` into it, as `startInside` does at `nested.ts:126`, so nothing from the test runner's environment reaches the inner host.

## Validation

- `packages/sdk/test/nested-process.test.ts`, each case failing today:
  - a child that exits at once (`sh -c 'echo no such plugin >&2; exit 3'`) ends the session with its stderr; today the outer process dies with `write EPIPE` (install a `process.on('uncaughtException')` guard in the test that fails it);
  - a child that closes its stdin and keeps running (`sh -c 'exec 0<&-; sleep 2'`) ends the session with a sentence; today it is an uncaught `EPIPE`;
  - a real inner host killed with SIGKILL after the first `chat/delta` of a paced turn ends with `session/creationFailed` and `chat/error` for that turn, and the sentence names SIGKILL; today it says only "ended.".
- `node_modules/.bin/vitest run packages/sdk/test/nested-process.test.ts packages/sdk/test/nested-proxy.test.ts` passes.

## Resume

Implemented 2026-10-06.
`stdioTransport` reads the end from `close` with the signal in the sentence, stdin has an `error` listener that waits 500 ms for the process's own end, and `stop` sends SIGTERM then SIGKILL after 3 s.
`packages/sdk/test/nested-process.test.ts` (new) runs a real `ahpd --stdio` with `test/fixtures/plugin-nested-echo` under an env of `PATH`, `HOME` and the XDG directories only; its exit, stdin-closed and SIGKILL cases failed before the change.
