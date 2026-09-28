---
title: pi's models and history outlive the process, and pi loads without holding the daemon - implemented
date: 2026-09-28
refs:
  - git://1d00d3f
  - "[code://packages/agent-pi/src/pi.ts](../../../../packages/agent-pi/src/pi.ts) - `loadPi` and `loadedPi`, pi's SDK imported on first use"
  - "[code://packages/agent-pi/src/replay.ts](../../../../packages/agent-pi/src/replay.ts) - a session file replayed into turns"
  - "[code://scripts/dev.mjs](../../../../scripts/dev.mjs) - the dev loader on `registerHooks`"
---

A pi session lists its models before any turn and after a restart, a pi session opened after a restart shows its whole conversation, a new session is saved under the id the client named, and the daemon starts without waiting for pi's SDK.

## What was built

- [`code://packages/agent-pi/src/pi.ts`](../../../../packages/agent-pi/src/pi.ts) - one memoised `import()` of pi's two packages; a failed import is retried by the next caller, and `plugin.ts` starts it in the background at apply.
- [`code://packages/agent-pi/src/backend.ts`](../../../../packages/agent-pi/src/backend.ts) - `runtimeModels` from pi's `ModelRuntime` for the probe; `resumeOrCreate` creates a new session under the client's UUID and a fork under a fresh one.
- [`code://packages/agent-pi/src/replay.ts`](../../../../packages/agent-pi/src/replay.ts) - `replayEntries` raises a file's entries through the live `mapEvent`, turns keep their entry ids, and a turn ends `error`, `cancelled` or `complete` as its last answer did.
- [`code://packages/agent-pi/src/session.ts`](../../../../packages/agent-pi/src/session.ts) - a resumed session's record starts with the replayed turns, and its truncation points are seeded from them.
- [`code://scripts/dev.mjs`](../../../../scripts/dev.mjs) and [`code://scripts/dev-hooks.mjs`](../../../../scripts/dev-hooks.mjs) - `module.registerHooks` when Node has it, `module.register` otherwise; [`code://docs/DAEMON.md`](../../../../docs/DAEMON.md) says what the fallback costs.

## Verified

- `packages/agent-pi/test/agent-pi-lazy.test.ts` holds pi's import on a gate and sees one import serve a `list` and a turn.
- `packages/agent-pi/test/agent-pi.test.ts` covers the probe, the replay against a live turn, a resumed record, an aborted turn, and the new, resumed and forked ids; each fix case failed first.
- By hand: the probe answered 396 models on this machine; a dev daemon logged agent-pi `in 4271 ms` before task 05 and `in 1065 ms` after.
- `pnpm test` 106 files, 1492 tests; `pnpm typecheck` and `pnpm boundary` green.
- Reviewed by Softov on 2026-09-28.

## Departures from the plan

- `Agent.stateFile` stays synchronous and answers `undefined` until pi has loaded (defaulted in the plan).
- Task 06, the session saved under the client's id, was added on 2026-09-28 after "No agent for session" after a restart.

## Left for later

- none.
