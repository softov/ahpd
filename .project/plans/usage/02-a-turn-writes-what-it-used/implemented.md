---
title: A turn writes what it used to the usage store, charged to its owner, team and project - implemented
date: 2026-10-02
refs:
  - "[code://packages/sdk/src/meter.ts](../../../../packages/sdk/src/meter.ts)"
  - "[code://packages/sdk/src/host.ts](../../../../packages/sdk/src/host.ts)"
  - "[code://packages/server/src/commands/options.ts](../../../../packages/server/src/commands/options.ts)"
---

Every turn on a host with a `usage` port leaves a `ModelUse` (`source: 'agent'`) with its tokens, the harness's cost, its owner, scope, session, chat, turn, agent and computer, charged to the owner's, team's and project's pools; `usage.per: "report"` in the daemon config writes one record per report instead.

## What was built

- [`code://packages/sdk/src/meter.ts`](../../../../packages/sdk/src/meter.ts) - the meter: holds each running turn's last report, writes it when the turn completes, is cancelled or fails, or per report writes what each report added; reads every harness's cost spelling and lowercases the currency.
- [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts) - a meter per session where `options.usage` is set, fed from the session's emit before the sender is let go of.
- `HostOptions.usagePer`, and `usage.per` in the daemon config (`Config`, `serverFields`, file only), passed by `run.ts`; documented in `docs/DAEMON.md`.

## Verified

- `packages/sdk/test/usage-meter.test.ts` (16 cases): complete, cancelled and failed turns; no report; model from the turn; sender versus session owner; no users and no project; each harness's cost; a failing store; a worker chat; no usage port; per report summing to the last report, a count that came down, a turn that never said it began.
- `packages/server/test/config-check.test.ts`: `usage.per` checked, defaulted and refused by name.
- `pnpm exec tsc --noEmit` clean; `pnpm test` 141 files, 2097 tests passed; `pnpm boundary` clean.

## Departures from the plan

- `usage.per` is declared in `packages/server/src/commands/options.ts`, which the task did not name, because the config file is checked against `serverFields` there.
- A report for a turn the host never saw start is metered from the report; a report after a turn ended is ignored, remembering the last 1024 ended turn ids.
- Per report, an unchanged count writes zero, so the records of a turn sum to its last report.
- A record with no model named is written with `name: ''` - decision [a-model-record-with-no-model-named-has-an-empty-name](../../../decisions/a-model-record-with-no-model-named-has-an-empty-name.md).

## Left for later

- Nothing from this plan; reading usage back is usage/04, prices usage/05.
