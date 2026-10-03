---
title: A failure belongs to the item that failed - implemented
---

## What exists

- `packages/sdk/src/plugins.ts`: a clashing agent is reported with `AGENT_CLASH` and not added; the first holder keeps the id; `run.ts` no longer exits on a clash (only on no backend at all).
- `packages/sdk/src/host.ts`: a session recorded for a provider that did not load is listed under that provider (`waitingFor`) and every road refuses it with `-32002 <provider> is not loaded on this host`: subscribe under any spelling, turns, `fetchTurns`, config change, `chat/draftChanged`, annotation actions and the marks channel, and `unheld` refuses creating a session over its id. `kept.provider` is never rewritten for it. An unrecorded session keeps the first-lister fallback.
- `PluginHost.problem(line)`; load problems and plugin problems travel in the start announcement into `Running.skipped`, and `ahpd start` and `ahpd restart` print them as `skipped: <line>` before the success line, one line each (`oneLine`), exit 0.

## Verified

- Reviewer probes for each task, re-run after two fix turns: clash keeps base `pi` and the rest of the plugin; a waiting session is refused on every road and its record stays; creating over its id is refused; start and restart print skipped lines in order with exit 0; no line carries a secret value.
- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test`.

## Departures

- The fold case lives in `plugin-host.test.ts`, not the fold's own test file.
