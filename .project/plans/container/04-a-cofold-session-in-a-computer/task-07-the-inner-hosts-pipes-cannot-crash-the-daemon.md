---
title: The inner host's pipes cannot crash the daemon
status: todo
depends: [task-06-docs.md]
layer: "sdk | test"
refs:
  - "[code://packages/sdk/src/nested.ts#L138-L203](../../../../packages/sdk/src/nested.ts#L138-L203) - `stdioTransport`, with no `error` listener on stdin and the end taken from `exit`"
  - "[code://test/nested-proxy.test.ts#L56-L128](../../../../test/nested-proxy.test.ts#L56-L128) - the in-memory fakes, which cannot raise EPIPE or reorder `exit` and stdout"
  - "[code://test/fixtures/plugin-echo/index.ts](../../../../test/fixtures/plugin-echo/index.ts) - the echo plugin a real inner host can load"
---

## Objective

A nested host that dies at any moment, or closes its stdin, ends the outer session with a sentence and never throws in the outer daemon, and that is proved against a real child process.

## Files

- `UPDATE: packages/sdk/src/nested.ts:173-190` - the `exit` listener and `send`; stdin has no `error` listener today.
- `CREATE: test/fixtures/plugin-nested-echo/index.ts` and `package.json` - the echo backend under provider `cofold`, its `pace` read from the `PACE` environment variable.
- `CREATE: test/nested-process.test.ts` - the proxy against real child processes.

## Steps

1. In `stdioTransport`, listen for `error` on `host.stdin` and treat it as the end, with the error's message as the reason, so a write to a dead pipe is a sentence and not an uncaught `EPIPE`.
2. Take the end from `close` instead of `exit`, so every stdout line the process wrote is delivered before the session ends.
3. Carry the signal into the sentence: `(code, signal)` from `close`, and a process killed by a signal says `it was killed by SIGKILL` rather than an empty reason.
4. Widen `NestedHost` (nested.ts:47) with whatever step 1 and step 2 need, and keep the in-memory fakes in `test/nested-proxy.test.ts` compiling.
5. In the new test, start the inner host as `process.execPath` with `--conditions development --import ./scripts/dev.mjs packages/server/src/main.ts --stdio --plugin ./test/fixtures/plugin-nested-echo`, with `HOME` and the XDG directories pointed at a temporary directory, through `NestedOptions.start`.

## Validation

- `test/nested-process.test.ts`, each case failing today:
  - a child that exits at once (`sh -c 'echo no such plugin >&2; exit 3'`) ends the session with its stderr; today the outer process dies with `write EPIPE` (install a `process.on('uncaughtException')` guard in the test that fails it);
  - a child that closes its stdin and keeps running (`sh -c 'exec 0<&-; sleep 2'`) ends the session with a sentence; today it is an uncaught `EPIPE`;
  - a real inner host killed with SIGKILL after the first `chat/delta` of a paced turn ends with `session/creationFailed` and `chat/error` for that turn, and the sentence names SIGKILL; today it says only "ended.".
- `node_modules/.bin/vitest run test/nested-process.test.ts test/nested-proxy.test.ts` passes.

## Resume
