---
title: A Claude tool call's toolInput is its whole input, and invocationMessage stays the short line - implemented
---

## What exists

- `toolInputOf` (`packages/agent-claude/src/input.ts`) is the call's whole input as JSON, or the command for Bash, on the live call, its ready action, the permission path and restored calls.
- A row's line is never cut JSON: `lineOf` and `pastLineOf` follow VS Code's `getClaudeInvocationMessage` and `getClaudePastTenseMessage`, a described tool reads its `description`, and any other subject is its first non-blank line cut to 80 characters.
- A confirmation that lands while the call streams carries the whole input.
- The wire fixture holds `ahpd.durationMs` steady, so it no longer changes on every run.

## Verified

- Reviewed 2026-10-03 against current code: every task holds; the claude/08 tests fail when their fix is reverted.
- The review's fix: a multi-line MCP argument, a long AskUserQuestion question, a long WebSearch query and an argument starting with blank lines each give one line of at most 80 characters.
- After rebasing onto main: `pnpm exec tsc --noEmit`, `pnpm boundary` pass; `pnpm test` 2672 of 2673 with `agent-cofold-store.test.ts` timing out under a parallel build's load, passing three runs of three alone.

## Departures

- A cut at 80 characters may split an emoji, and a WebFetch link target is not escaped; VS Code does both the same way.
- A call confirmed while streaming skips the rest of the assistant handling; it predates this plan and is `problems/a-claude-call-confirmed-while-streaming-skips-its-bookkeeping.md`.
