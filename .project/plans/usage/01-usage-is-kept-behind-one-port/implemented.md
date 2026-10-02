---
title: Usage is kept behind one port, model use and computer time, with live totals - implemented
date: 2026-10-01
refs:
  - "[code://packages/sdk/src/types/usage.ts](../../../../packages/sdk/src/types/usage.ts)"
  - "[code://packages/sdk/src/usage.ts](../../../../packages/sdk/src/usage.ts)"
---

The host has a `usage` port that keeps model use and computer time and answers a pool's running total over a period; the daemon keeps it in monthly JSONL files under its config folder, and a plugin may replace it.

## What was built

- [`code://packages/sdk/src/types/usage.ts`](../../../../packages/sdk/src/types/usage.ts) - `UsageBase`, `ModelUse`, `ComputerTime`, `Owner`, `Cost`, `UsageTotal` and the `Usage` port.
- [`code://packages/sdk/src/usage.ts`](../../../../packages/sdk/src/usage.ts) - `fileUsage`, one file per month and kind, appends serialised, totals per pool per day rebuilt at start.
- `usage` in `HostOptions`, `PortKey` and the port checks, and `registerUsage` for plugins.
- [`code://packages/server/src/commands/run.ts`](../../../../packages/server/src/commands/run.ts) - the daemon keeps usage in `<config>/usage`.

## Verified

- `packages/sdk/test/usage.test.ts` (10 cases), `packages/server/test/usage-port.test.ts`, and the port rows in `plugin-fold.test.ts` and `plugin-validate.test.ts`.
- `pnpm exec tsc --noEmit` clean; `pnpm test` 133 files, 1973 tests passed.

## Departures from the plan

- Records follow the base agreed after the plan was written: every record carries `kind`, `session`, `turn`, `agent` and `computer`; a model record nests `model: { name, provider, input, output, cache }`; computer time is `at` plus `seconds`. `Owner` gained `root:<host>` and is optional.
- `fileUsage` takes `{ folder, onProblem }`, like the other file stores.
- `total` is kept per day, so a partly covered day counts whole.

## Left for later

- Nothing writes records yet: the agent meter and the proxy listener do.
- `docs/PLUGINS.md` does not list `registerUsage` yet.
