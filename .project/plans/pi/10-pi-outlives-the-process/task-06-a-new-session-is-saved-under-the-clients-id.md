---
title: A new pi session is saved under the id the client named
status: implemented
depends: [task-01-agent-pi-loads-without-importing-pi.md]
layer: "agent-pi"
refs:
  - "[code://packages/agent-pi/src/backend.ts#L157-L167](../../../../packages/agent-pi/src/backend.ts#L157-L167) - `resumeOrCreate`, which lets pi pick a new id"
  - "[code://packages/agent-claude/src/session.ts#L1997](../../../../packages/agent-claude/src/session.ts#L1997) - claude starts a new session under the client's UUID"
  - "[code://packages/agent-cofold/src/session.ts#L191-L193](../../../../packages/agent-cofold/src/session.ts#L191-L193) - cofold names a new session by the client's URI, and a fork by a fresh id"
  - "[code://packages/sdk/src/host.ts#L3888](../../../../packages/sdk/src/host.ts#L3888) - the error a client gets when no agent answers its session id"
  - npm://@earendil-works/pi-coding-agent@^0.87.1 - `SessionManager.create(cwd, sessionDir, { id })`, `NewSessionOptions.id`
---

## Objective

A pi session a client created is written under the id in the client's session URI, so after a restart the catalogue lists it under the URI the client kept, and opening it does not fail with "No agent for session".

## Files

- `UPDATE: packages/agent-pi/src/backend.ts:157-167` - `resumeOrCreate` creates with `{ id }` when it is given one.
- `UPDATE: packages/agent-pi/src/session.ts` - a new session passes the id from `start.uri`; a fork gets a fresh id; a resume keeps its own.
- `UPDATE: packages/agent-pi/test/` - the cases below.

## Steps

1. Mirror the siblings: a new session is created with the id of `start.uri`, a fork (`start.forkAt`) with a fresh one, and a resume with `start.resume`.
2. A resume id with no file is created under that id, so the conversation keeps its name.
3. An id pi would refuse (not a UUID, as claude checks) keeps pi's own.

## Validation

- A case: a session created from `ahp-session:/<uuid>` runs a turn, and pi's file is named by that uuid; `list()` answers a row with that id. Today the file has pi's own id, so it fails first.
- A case: a fork gets an id other than its source's.
- By hand, for Softov: create a pi session in VS Code, restart the daemon, and open it from the list.
- `pnpm typecheck`, `pnpm boundary`, `pnpm test` green.

## Resume

Implemented 2026-09-28.
`backend.ts` adds `id` and `fork` to `BackendOptions` and exports `resumeOrCreate` and `isUuid`: a new session is created under `id`, a resume id with no file under that id, a fork is `SessionManager.forkFrom` the source under a fresh id, and an id that is not a UUID is left to pi.
`session.ts` passes the URI's id on a new session's first open when it is a UUID, nothing on a resume, and `fork: true` on a fork's first open.
`packages/agent-pi/test/agent-pi.test.ts` adds `opens a new session under the UUID its URI names`, `opens a fork as a copy of its source rather than the source itself`, `saves a new session under the id it was given, and lists it by that id`, `creates a resumed id that has no file under that id` and `forks a session from disk under a fresh id and leaves the source as it was`, which each failed first.
It also adds `leaves the id to pi when the URI does not name a UUID` and `resumes under the id it was resumed with, not the URI`, which guard behaviour that already held and passed before the change.
`pnpm typecheck` and `pnpm boundary` green, and `pnpm test`: 106 files, 1492 tests passed.
