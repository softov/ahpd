---
title: A Claude tool call confirmed while it streams skips the rest of the assistant handling
status: open
date: 2026-10-03
severity: minor
refs:
  - "[code://packages/agent-claude/src/session.ts#L1733](../../packages/agent-claude/src/session.ts#L1733) - `assistant()` returns early for a call `canUseTool` already confirmed while it streamed"
  - "[code://packages/agent-claude/src/session.ts#L3676](../../packages/agent-claude/src/session.ts#L3676) - the approval sets the status line with `busyWith(name, {})`, which drops the subject"
---

## Symptom

A tool call that `canUseTool` confirms before its full input has streamed in never runs the rest of `assistant()`'s handling for that call: no `doing(busyWith...)` status, no `editing` "before" snapshot, no `spawning` for Task/Agent, no `onServer` and no `opening`.
After approval the status line names the tool with no subject.

## Cause

`assistant()` stops at `session.ts:1733` for a call already confirmed while streaming, and the approval path builds the status line from an empty input.
Both predate claude/08; found by its review on 2026-10-03.

## Impact

For such a call: a changeset may lack the edited file's "before" content, a Task/Agent worker may not be opened as a worker chat, and the status line is less specific.
How often a confirmation lands before the input finishes streaming is not measured.

## Workaround

none

## Fix

Undecided.
