---
title: A nested session whose host ended refuses what follows with the reason
status: accepted
date: 2026-09-26
refs:
  - "[code://packages/sdk/src/nested.ts#L253-L261](../../packages/sdk/src/nested.ts#L253-L261) - `deliver`, which drops everything once `ended` is set"
  - "[code://packages/sdk/src/nested.ts#L270-L285](../../packages/sdk/src/nested.ts#L270-L285) - `fail`, the sentence the session ended with"
  - "[code://packages/sdk/src/host.ts#L1879](../../packages/sdk/src/host.ts#L1879) - `refuse`, how the host answers an action it will not apply"
---

## Context

When the inner host ends, the proxy emits `session/creationFailed` with a sentence and fails the running turn.
Anything a client sends after that is dropped by `deliver` without an answer.
Driven against a real inner `ahpd --stdio` killed with SIGKILL, a following `chat/turnStarted` produced no action and no refusal, so the client's optimistic turn waited for ever.

## Decision

A nested session whose inner host has ended refuses every later action and turn with the sentence it ended with; it neither hangs nor starts the inner host again.
Source: Softov, 2026-09-26, asked "After the inner host dies: should the proxy (a) refuse later actions with the sentence, (b) restart the inner host on the next turn, or (c) have the outer host close the session?": "refuse later actions and turns with the reason (no hang, no restart)".

## Consequences

The host needs to know that a session has ended and why, before it routes a client action to it, so `Session` gains an optional member the host reads, and the host answers with `refuse` and that sentence.
A person who wants to carry on starts a new session; nothing restarts an inner host behind their back.

## Options

- **Restart the inner host on the next turn.** Recovers from a transient failure, but hides a machine that keeps dying and loses the inner session's in-memory state.
- **Have the outer host close the session.** Clean, but the client loses the transcript it was looking at and the reason with it.
