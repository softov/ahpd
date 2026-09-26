---
title: A moved store still resumes
status: dropped
depends: []
layer: "agent-pi"
refs:
  - "[code://packages/agent-pi/src/backend.ts#L98-L107](../../../../packages/agent-pi/src/backend.ts#L98-L107) - `resumeOrCreate`"
---

## Objective

A resume whose id is not under the working directory's key in pi's default store is still found, when the session file exists elsewhere in that store.

Dropped with plan 08 on 2026-09-26.

## Files

- `UPDATE: packages/agent-pi/src/backend.ts:98-107` - a fallback lookup when `findById` finds nothing and no `sessionDir` was set.
- `UPDATE: test/agent-pi.test.ts` - the case below.

## Steps

1. Once the question is answered, settle the lookup and write it here.

## Validation

- A test with a temporary store: a session written under one project path is resumed from another.
- `pnpm test`, `pnpm typecheck` green.

## Resume
