---
title: toolInput is the whole input
status: implemented
depends: []
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/session.ts#L170-L176](../../../../packages/agent-claude/src/session.ts#L170-L176) - `summarize`"
  - "[code://packages/agent-claude/src/transcript.ts#L25-L33](../../../../packages/agent-claude/src/transcript.ts#L25-L33) - the restored copy"
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

Implemented 2026-09-29.
VS Code reads a non-terminal call's `toolInput` as JSON: `getToolRawInput` in `stateToProgressAdapter.ts` parses it, falling back to `{ input }` when it will not parse, and `addCommentReference` and `createSessionTitleFromArgs` parse it too; its own Claude adapter (`getClaudeToolInputString`) sends the whole input as JSON and the command for Bash. So the change goes the way VS Code already expects.
`packages/agent-claude/src/input.ts` is new and holds `summarize`, moved from `session.ts` and `transcript.ts` unchanged, and `toolInputOf`: the whole input as `JSON.stringify(input)`, uncut, or the command for Bash, and absent for an empty input as before.
`packages/agent-claude/src/session.ts` sets `toolInput` from `toolInputOf` on the live call and its `chat/toolCallReady`, and on the permission path's call and its `chat/toolCallReady`; `invocationMessage` still comes from `summarize`. `packages/agent-claude/src/transcript.ts` does the same for a restored call. The typed-command terminal call keeps its command, as before.
Validated by `packages/agent-claude/test/agent-claude-tool-input.test.ts`, which failed first: a live call (snapshot and ready action) and a restored call of a tool with an input over 400 characters parse back whole from `toolInput` with `invocationMessage` still the 400-character summary, and Bash's `toolInput` and `invocationMessage` are its command live and restored.
Gates: `pnpm typecheck`, `pnpm boundary` and the full `pnpm test` three times, all exit 0 (121 files, 1719 tests each run).
