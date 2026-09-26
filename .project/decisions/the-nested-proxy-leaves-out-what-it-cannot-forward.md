---
title: The nested proxy leaves out what it cannot forward
status: accepted
date: 2026-09-26
refs:
  - "[code://packages/sdk/src/nested.ts#L464-L510](../../packages/sdk/src/nested.ts#L464-L510) - the methods that answer `true` whatever happened"
  - "[code://packages/sdk/src/types/session.ts#L213-L495](../../packages/sdk/src/types/session.ts#L213-L495) - `Session`, whose optional members the host refuses when absent"
---

## Context

`steer`, `resume`, `setAnswer`, `setConfig`, `setCustomizationEnabled`, `startMcpServer` and `stopMcpServer` on the proxy dispatch and answer `true` without knowing whether the inner session took it.
The `Session` contract says these answer whether there was something to act on, and that a control reporting success while changing nothing is worse than one that refuses.
Several optional members are absent (`setTitle`, `forkPoint`, `endPoint`, `ran`, `setTools`, `toolCallOwner`, `completeToolCall`, `clientGone`, `authenticated`), which the host already refuses honestly.

## Decision

The proxy implements a `Session` member only when it can forward it and report the inner session's real answer; everything else is left out, so the host refuses it with its own reason.
Source: Softov, 2026-09-26, asked "Unsupported `Session` methods: should the proxy (a) round-trip them and relay the inner answer, (b) leave them out so the host refuses them honestly, or (c) keep answering `true`?": "leave them out so the host refuses them honestly (no blind `true`)".

## Consequences

An optional member the proxy cannot answer truthfully is removed.
A required member (`setCustomizationEnabled`, `startMcpServer`, `stopMcpServer`) answers from the mirrored inner state, `false` when the inner session has no such customization or server.
A member that can be answered from the mirror (`steer` needs a running turn, `resume` a failed last turn, `setAnswer` an open input request) answers from it rather than `true`.

## Options

- **Round-trip every member and relay the inner answer.** Most faithful, but AHP dispatch is fire-and-forget, so each would need a request the protocol does not have.
- **Keep answering `true`.** Nothing to build, and a client is told a control worked when it did nothing.
