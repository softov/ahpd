---
title: A live Claude call says what it runs on
status: implemented
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

- **Done:** the three places `packages/agent-claude/src/session.ts` readies a call from the assistant message (the new call's literal, the streamed call moved to `running`, and the `chat/toolCallReady` action) set `invocationMessage` to `command ?? name`, where `command` is `summarize(name, input)`; `pastTenseMessage` already follows `invocationMessage`.
- The permission path (`canUseTool`) is untouched: an asked call keeps the CLI's title when it has one.
- The comment on the ready action said the intention is the tool's name and never its input, so the command is not drawn twice beside `toolInput`; it now says what the plan decided.
- **Tests:** in `packages/sdk/test/host.test.ts`, under "one tool call, one row": new "says what a finished call ran, as its transcript does" (`pastTenseMessage` `ls`); "says the transcript is not asking anything" and "says the same on the call as it says in the action" now expect `invocationMessage` `ls` where they asserted `Bash`. The fixture's command is `ls`, not `ls -la`.
- **Failed first:** all three with `Bash` where `ls` was expected.
- **Departures:** the two existing assertions that the intention is not the input were reversed, as the plan's first decision requires; a client now shows the command both as the intention and as `toolInput`, as a replayed Claude call already did.
- `packages/sdk/test/fixtures/wire.jsonl`, which `wire.test.ts` writes on every run, changed with it: its live `Read` call now says `/home/softov/a` where it said `Read`, in three lines.
- **Gates:** `pnpm typecheck` clean; `pnpm boundary` clean; `pnpm test` 1561 passed of 1561 in 108 files.
