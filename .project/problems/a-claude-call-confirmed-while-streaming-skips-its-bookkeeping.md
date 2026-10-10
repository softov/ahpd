---
title: A Claude tool call confirmed while it streams skips the rest of the assistant handling
status: open
date: 2026-10-03
severity: minor
refs:
  - "[code://packages/agent-claude/src/session/stream.ts#L320](../../packages/agent-claude/src/session/stream.ts#L320) - `assistant()` returns early for a call `canUseTool` already confirmed while it streamed"
  - "[code://packages/agent-claude/src/session/asking.ts#L398](../../packages/agent-claude/src/session/asking.ts#L398) - the approval sets the status line with `busyWith(name, {})`, which drops the subject"
---

## Symptom

`canUseTool` can confirm a tool call before its full input has streamed in.
Then `assistant()` skips the rest of its handling for that call: no `doing(busyWith...)` status, no `editing` "before" snapshot, no `onServer` and no `opening`.
After approval the status line names the tool with no subject.

## Cause

`assistant()` stops at `stream.ts:320` for a call already confirmed while streaming, and the approval path builds the status line from an empty input.
Both predate claude/08; found by its review on 2026-10-03.
claude/17 fixed the Task/Agent part: the permission callback now records the spawn too (`git://7a02145`).

## Impact

For such a call: a changeset may lack the edited file's "before" content, and the status line is less specific.
How often a confirmation lands before the input finishes streaming is not measured.

## Workaround

none

## Fix

Undecided.
