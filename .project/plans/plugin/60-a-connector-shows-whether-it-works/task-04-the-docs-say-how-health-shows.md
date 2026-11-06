---
title: The docs say how a connector shows health
status: done
depends: [task-02-a-host-secret-can-name-an-env-variable.md, task-03-the-channel-keeps-health.md]
layer: "docs"
refs:
  - "[code://docs/plugins/PLUGINS.md#L503](../../../../docs/plugins/PLUGINS.md#L503) - the adapter section"
  - "[code://docs/plugins/PLUGINS.md#L1176](../../../../docs/plugins/PLUGINS.md#L1176) - the connectors commands table"
  - "[code://docs/sdk/HOST.md#L177](../../../../docs/sdk/HOST.md#L177) - the grants table for connectors"
---

## Objective

The plugin docs say how an adapter gives a check, and what `health` holds.
They say how a host connector names an environment variable, and what the check command does.

## Files

- `UPDATE: docs/plugins/PLUGINS.md` - the adapter section gets `check` and the env reference, and the commands table gets `x-ahpd/connectors/check`.
- `UPDATE: docs/sdk/HOST.md` - the grants table gets a row for checking a connector.

## Steps

1. Add `check` to the adapter section, with a short example that calls a service with the connector's key.
2. Describe the four results and the 10 second limit.
3. Describe the `health` key on a row, and say it lives in memory only.
4. Describe `{ "fromEnv": "<NAME>" }` for a host connector. Say a team's or person's connector cannot use it, on a put or at open.
5. Add the `x-ahpd/connectors/check` row to the commands table.
6. Add the row "Check a connector" to the grants table in `HOST.md`.
7. Keep each paragraph on one line, as the files already are.

## Validation

- `pnpm -s build` passes, with the docs build if the gate runs it.
- By hand: each new command and field in the docs matches the code.

## Resume

- **Done so far:** the adapter example in `docs/plugins/PLUGINS.md` has an async `check` that calls the service with the connector's key and answers `ok` or `denied`. A new bullet describes `check(connector)`, the four results, the 10 second limit, the put waiting and the start not waiting. The `writeOnly` bullet now describes `{ "fromEnv": "<NAME>" }` for a host connector. It gives the refusal for a team or a person, on a put and again at open. The connectors section has a paragraph on `health`: its three parts, its memory-only lifetime and the 500 character cut. Its command intro now says a third command checks one, the put row says its answer carries the check, and a new row adds `x-ahpd/connectors/check`. `docs/sdk/HOST.md` has the grants table row "Check a connector".
- **Next action:** none; this is the last task.
- **Files:** `docs/plugins/PLUGINS.md`, `docs/sdk/HOST.md`, this task file, the plan and the index. The session cannot commit, so they are left in the worktree.
- **Open questions:** none.
- **Departures:** the `health` paragraph sits in the connectors section, just above the commands table, because that is where the `state` table it extends is. The Icons section, which plan 58 edits, was not touched. The docs first named the environment form `{ "$env": "<NAME>" }`; Softov's review of 2026-10-23 settled on `{ "fromEnv": "<NAME>" }`, the form presets use, and the sentence now says so.
- **Watch out for:** plan 58 rewrites the same file in its Icons section, so a merge there needs the two changes kept apart.
