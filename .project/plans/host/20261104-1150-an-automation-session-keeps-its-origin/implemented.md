---
title: An automation session keeps its origin after a restart - implemented
date: 2026-11-04
refs:
  - git://a9f497a3
  - "[code://packages/sdk/src/sessions/sessions.ts](../../../../packages/sdk/src/sessions/sessions.ts) - the stored automation origin"
  - "[code://packages/sdk/src/host/localturns.ts](../../../../packages/sdk/src/host/localturns.ts) - the origin on a turn's record"
  - "[code://packages/sdk/src/host/catalogue.ts](../../../../packages/sdk/src/host/catalogue.ts) - a summary's origin, read from the store"
---

A session an automation started says so after ahpd restarts. Its summary names the automation and the run. Its first turn reads back with message origin `automation`, so ahpw draws "From an automation" as it did before the restart.

## What was built

- [`code://packages/sdk/src/types/sessions.ts`](../../../../packages/sdk/src/types/sessions.ts) - `AutomationOrigin`, and the optional `automationOrigin`/`setAutomationOrigin` pair on the store.
- [`code://packages/sdk/src/sessions/sessions.ts`](../../../../packages/sdk/src/sessions/sessions.ts) - the row keeps `automationOrigin`, writes it with the row, and reads it back at start in both stores.
- [`code://packages/sdk/src/host/lifecycle.ts`](../../../../packages/sdk/src/host/lifecycle.ts) - the origin is written to the store where `origins` gets one, and cleared where a disposed session loses one.
- [`code://packages/sdk/src/host/automations.ts`](../../../../packages/sdk/src/host/automations.ts) - a run that reuses a session writes its origin to the store as well.
- [`code://packages/sdk/src/host/catalogue.ts`](../../../../packages/sdk/src/host/catalogue.ts) - `originOf` fills `origins` from the store for a session it does not hold, and the live and held rows carry the origin.
- [`code://packages/sdk/src/host/localturns.ts`](../../../../packages/sdk/src/host/localturns.ts) - a `Recorded` file holds an optional `origin`, `turnRecordedAs` writes it, and `transcriptOf` puts it on each transcript turn before `asBegun` folds.
- [`code://packages/sdk/src/host/spawn.ts`](../../../../packages/sdk/src/host/spawn.ts) - a started message's origin is recorded when its kind is not `user`, and `onTurnRecorded` carries it to the record under the backend's id.
- [`code://packages/sdk/test/host-automation-origin.test.ts`](../../../../packages/sdk/test/host-automation-origin.test.ts) - the origin outlives a host that closes and opens on the same store.

## Verified

- `pnpm build` passed.
- `pnpm typecheck` passed.
- `pnpm boundary` passed: 13 packages, none undeclared.
- The sdk suite passed: 225 files, 4212 tests passed, 4 skipped.
- The agent-claude suite passed: 57 files, 547 tests passed.
- `packages/sdk/test/host-automation-origin.test.ts`: 1 passed.
- `packages/sdk/test/host-local-turns.test.ts`: 28 passed, including a turn recorded with origin `automation` and a record without an origin.
- Softov ran the automation origin check of `claude-1150-origin-and-notice-checks.md` on 2026-11-04, and it passed: after a restart, the session still names its automation.

## Departures from the plan

- The store pair is typed by an exported `AutomationOrigin` in `types/sessions.ts`, re-exported from `index.ts`, rather than an inline shape.
- `LocalTurns` gained `turnOriginOf(chat, turnId)`, which step 4 needs to look up the origin before recording the turn under the backend's id.
- The failed-open path at `lifecycle.ts` clears `origins` and then forgets the whole row, so the stored origin goes with it and needs no second clear.

## Left for later

- none
