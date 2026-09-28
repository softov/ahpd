---
title: A live Claude call says what it runs on
status: todo
depends: []
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/session.ts#L1545-L1602](../../../../packages/agent-claude/src/session.ts#L1545-L1602) - `invocationMessage: name` in three places"
  - "[code://packages/agent-claude/src/session.ts#L1652-L1668](../../../../packages/agent-claude/src/session.ts#L1652-L1668) - `pastTenseMessage` from `invocationMessage`"
  - "[code://packages/agent-claude/src/transcript.ts#L330-L333](../../../../packages/agent-claude/src/transcript.ts#L330-L333) - the transcript's `summarize ?? name`, which live now matches"
---

## Objective

A live Claude call's `invocationMessage` is `summarize(name, input) ?? name`, as the replayed call's is, so its past tense follows.

## Files

- `UPDATE: packages/agent-claude/src/session.ts:1545-1602` - `invocationMessage: command ?? name` where the call is readied.
- `UPDATE: packages/agent-claude/test/` or `packages/sdk/test/host.test.ts` - the case below, where the live `Bash` call cases live.

## Steps

1. The permission path's `invocationMessage` (`session.ts:1860`) keeps the SDK's title when it has one.
2. `summarize`'s JSON fallback for other tools is kept, since the transcript already sends it.

## Validation

- A live `Bash` call with `ls -la` has `invocationMessage` and `pastTenseMessage` `ls -la`, matching the replayed call; it fails first.
- `pnpm typecheck`, `pnpm boundary`, `pnpm test` green.

## Resume
