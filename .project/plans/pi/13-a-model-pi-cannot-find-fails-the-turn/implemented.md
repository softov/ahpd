---
title: A model pi cannot find fails the turn that asked for it - implemented
date: 2026-10-02
refs:
  - "[code://packages/agent-pi/src/backend.ts](../../../../packages/agent-pi/src/backend.ts) - `choose` answers whether it resolved the id"
  - "[code://packages/agent-pi/src/session.ts](../../../../packages/agent-pi/src/session.ts) - the turn fails on a refused pick"
---

A turn naming a model pi does not have ends with `pi has no model <id>`, prompts nothing, and leaves the session on its model; the configured `model` and a rebuild's carried model still fall back.

## What was built

- `PiBackend.choose` answers `false` for an id it cannot resolve and `true` otherwise.
- The turn path throws on `false`, inside the try whose catch fails the turn, so the queue goes on as after any failed turn.

## Verified

- `packages/agent-pi/test/agent-pi.test.ts`: a refused pick fails the turn with nothing prompted and the next turn runs on the previous model; an unknown configured `model` still opens and prompts; a known pick prompts with no error. The test fake now resolves ids against its own list.
- `pnpm exec tsc --noEmit` clean; `pnpm test` 140 files, 2081 tests passed; `pnpm boundary` clean.

## Departures from the plan

- The refused turn's `chat/turnStarted` still names the model it asked for, beside the error that says pi has none; claude/14's refused turn names none.
