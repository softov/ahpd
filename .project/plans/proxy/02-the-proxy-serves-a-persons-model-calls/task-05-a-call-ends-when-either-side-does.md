---
title: A call ends when either side does, and on a timeout
status: todo
depends: [task-04-the-call-streams-through.md]
layer: "server"
refs:
  - npm://@cofold/remote@0.4.0 - `toNodeListener` aborts `request.signal` when the client's response closes unfinished
---

## Objective

A caller that hangs up cancels the upstream call at once; a provider that sends no headers within 120 s, or goes 300 s between chunks, is cut off; and a call that fails before anything came back goes to the next candidate.

## Files

- `UPDATE: packages/server/src/proxy/listener.ts` - one `AbortController` per call, aborted by `request.signal`, by the header timer and by the idle timer on the body.
- `UPDATE: packages/server/test/proxy-forward.test.ts`.

## Steps

1. `request.signal` aborting aborts the upstream `fetch` and its body.
2. No status and headers within 120 s: 504 in the dialect's body naming the provider. Then the idle timer restarts on every chunk; at 300 s the stream is ended, since a status was already sent, and the log says which provider stalled.
3. Fallback: on a refused connection, a header timeout, a 429 or a 5xx, and only then, the next candidate from task 03 is tried with its own key and id; the answer the caller gets is the last one tried; the log names each provider tried and why it was left. Nothing is retried once a byte has reached the caller.
4. The timeouts are constants in `listener.ts`, overridable by the test through `ProxyOptions`, and not a config key yet.

## Validation

- Failing first: a fake that never answers holds the call open past the test's short header timeout.
- A client that aborts mid-stream: the fake sees its request closed within a second.
- Header timeout: 504 in the dialect's body. Idle timeout: the stream ends after the events already sent.
- Fallback: a fake answering 503 then a second answering 200 gives the 200; a fake answering 400 is not retried; a fake that fails after its first event is not retried.

## Resume
