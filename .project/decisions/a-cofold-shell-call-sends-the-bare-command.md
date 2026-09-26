---
title: A cofold shell call sends its bare command as the tool input, as Claude's Bash does
status: accepted
date: 2026-09-26
refs:
  - "[code://packages/agent-cofold/src/tools.ts#L251-L262](../../packages/agent-cofold/src/tools.ts#L251-L262) - `toolReadyAction`, which writes every input as JSON"
  - "[code://packages/agent-cofold/src/mapping.ts#L404-L426](../../packages/agent-cofold/src/mapping.ts#L404-L426) - the approval path, which writes the input as JSON too"
  - "[code://packages/agent-claude/src/session.ts#L1499](../../packages/agent-claude/src/session.ts#L1499) - Claude's Bash, whose `toolInput` is the command itself"
---

## Context

A `shell_exec` call is stamped `_meta.toolKind: 'terminal'`, but its `toolInput` is `{"command":"echo hi"}`, so the terminal renderer draws JSON where Claude's Bash draws the command.
The host's `commanded` runs a `!` command in a host terminal a person can watch; `shell_exec` runs in cofold's process and has no terminal resource.

## Decision

A `shell_exec` call's `toolInput` is the bare command string, as Claude's Bash sends it, on every action and part that carries one.
The command still runs in cofold's own process, not in a host terminal.
Source: Softov, 2026-09-26, asked "Should `shell_exec` look more like a host terminal: (a) as now, `_meta.toolKind: 'terminal'` with the input as JSON; (b) `toolInput` as the bare command, like Claude's Bash; (c) run through the host's terminals so a person can watch it?": "Bare command, like Claude".

## Consequences

A cofold shell row reads like a Claude one in VS Code: the command above, the output below.
The output is text in the result, not a live terminal a person can attach to.

## Options

- **JSON input.** The terminal renderer draws an object where a person expects a command line.
- **A host terminal.** Watchable, but the tool would run in the host rather than in cofold, against [the decision that cofold runs its own tools](cofold-runs-its-own-tools-in-its-process.md).
