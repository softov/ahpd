---
title: session.ts is split into one file per area, and session.ts only composes them - implemented
date: 2026-10-04
refs:
  - "[code://packages/agent-claude/src/session.ts](../../../../packages/agent-claude/src/session.ts) - composes the areas"
  - "[code://packages/agent-claude/src/session/context.ts](../../../../packages/agent-claude/src/session/context.ts) - the shared state every area reads"
---

`packages/agent-claude/src/session.ts` went from 4,234 lines to 263, and each area is a file of its own under `packages/agent-claude/src/session/`.

## What was built

- `session/context.ts` - one `SessionContext`, built once; a `let` more than one area reads is a field on it.
- `common.ts`, `customizations.ts`, `config.ts`, `clienttools.ts`, `parts.ts`, `workers.ts`, `stream.ts`, `asking.ts`, `query.ts`, `servers.ts` and `turns.ts`, none over 607 lines; each area's `Session` methods are a `methods` table `session.ts` spreads.

## Verified

- A pure move: the old file's lines, with `ctx.` and imports set aside, are all in the new files; what is new is the context type, the factories and their wiring.
- The start keeps its order: the stored model, the shell init and the host's tools before the first query, then `describe` and `consume`; every area now exists before the first query starts.
- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass.

## Departures from the plan

- None.

## Left for later

- The tasks stay `implemented` until Softov reviews them.
