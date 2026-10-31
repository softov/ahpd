---
title: The host owes a steering message, so a session in a machine answers it
status: dropped
depends: []
layer: host
refs:
  - "[code://packages/sdk/src/sessions/nested.ts#L531](../../../../packages/sdk/src/sessions/nested.ts#L531) - the proxy's `carry`, which takes `start.handed` for every action it hands on"
---

## Objective

A steering message a client sends to a session in a machine is answered by the host inside, and that answer reaches the client with its own origin.

## Resume

Dropped 2026-10-31: the behaviour is in place on `ab07054c`.
The proxy takes `start.handed` inside the dispatch for every action it carries to the host inside, so the answer from inside goes out with the client's origin.
A case with an inner backend that takes a message mid-turn (the echo backend with a `steer` that says the message) passed on `ab07054c` with the client's origin and no rejection.
