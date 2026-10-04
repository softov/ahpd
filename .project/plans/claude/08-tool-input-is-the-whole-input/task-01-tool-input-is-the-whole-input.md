---
title: toolInput is the whole input
status: done
depends: []
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/input.ts#L23-L36](../../../../packages/agent-claude/src/input.ts#L23-L36) - `summarize`"
  - "[code://packages/agent-claude/src/transcript.ts#L361](../../../../packages/agent-claude/src/transcript.ts#L361) - the restored copy"
---

## Objective

Every place agent-claude sets `toolInput`, live and restored, gives the whole input as `JSON.stringify(input)`, except Bash, whose `toolInput` stays its command. `invocationMessage` keeps the summary.

## Steps

1. Check how VS Code (`/github/externals/vscode`, `stateToProgressAdapter.ts`) reads `toolInput` for a non-terminal call, and stop and report if it expects the summary.
2. Failing first: a live and a restored call of a tool with an input longer than 400 characters carry it whole and parseable in `toolInput`; Bash's `toolInput` is still its command; `invocationMessage` is unchanged.
3. Change it in one place both paths use.

## Validation

- `pnpm typecheck`, `pnpm boundary`, full `pnpm test` 3 times.

## Resume
