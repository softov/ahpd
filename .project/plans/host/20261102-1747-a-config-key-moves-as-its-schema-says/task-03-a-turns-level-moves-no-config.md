---
title: A turn's thinking level moves no session config
status: done
depends: []
layer: agent-claude
refs:
  - "[code://packages/agent-claude/src/session/turns.ts#L286-L300](../../../../packages/agent-claude/src/session/turns.ts#L286-L300) - a turn's level written into the session's config"
  - "[code://packages/agent-claude/src/session/context.ts#L362-L381](../../../../packages/agent-claude/src/session/context.ts#L362-L381) - the settings in force"
---

## Objective

A turn that names a thinking level sets the CLI's effort for that turn.
The session's `effortLevel` stays as a client set it, and no `session/configChanged` is said.
A later turn that names no level sets the CLI back to the session's `effortLevel`.

## Files

- `UPDATE: packages/agent-claude/src/session/turns.ts:286-300` - the turn's level goes to the CLI alone.
- `UPDATE: packages/agent-claude/src/session/context.ts:362-381` - the effort a turn set over the session's.
- `UPDATE: packages/agent-claude/src/session/config.ts:276-282` - a set `effortLevel` is the effort in force.
- `UPDATE: packages/agent-claude/src/session.ts:68` - the context starts with no turn's level.
- `UPDATE: packages/sdk/test/host-harness.test.ts` - a turn with a level, then one without.

## Steps

1. Hold the level a turn set over the session's `effortLevel` in the session's context.
2. Set the CLI's effort to a turn's level, and say nothing on the session.
3. Set the CLI back to the session's `effortLevel` when a later turn names none.
4. Clear the turn's level when a client sets `effortLevel`.
5. Add a case that reads the session's channel and the CLI's flag settings across both turns.

## Validation

- The new case fails on `89ebe4d5` and passes after.
- The agent-claude test files pass.
- `pnpm run typecheck` is clean.

## Resume

Built 2026-11-02.

- The Claude cases live in `host-harness.test.ts`, which drives the backend through the host with the fake SDK.
- `host-harness.test.ts` moved with the behavior: its case read `effortLevel: 'xhigh'` back from the session's config.
- That case keeps the model and the level reaching the SDK, and the new case holds the session's config.
- On `89ebe4d5`'s sources the new case fails: a `session/configChanged` was said for the turn's level.
