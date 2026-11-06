---
title: The docs say the new row fields and the grants
status: done
depends: [task-10-a-plugin-row-says-what-loaded.md, task-11-a-plugin-command-marks-a-restart.md, task-12-plugins-and-connectors-have-grants.md]
layer: "docs"
refs:
  - "[code://docs/plugins/PLUGINS.md](../../../../docs/plugins/PLUGINS.md) - the plugin channel and the connectors channel"
  - "[code://docs/sdk/USERS.md](../../../../docs/sdk/USERS.md) - the table of subjects the host decides"
  - "[code://CHANGELOG.md](../../../../CHANGELOG.md) - `0.14.0 - unreleased`"
---

## Objective

A person reads the new row fields, the restart mark and the new grants in the docs.
The changelog says which grant a role adds to keep its access.

## Files

- `UPDATE: docs/plugins/PLUGINS.md` - the row fields `version`, `loaded`, `loadProblem` and `optionsSchema`, the restart mark, and the grants of both channels.
- `UPDATE: docs/sdk/USERS.md` - the `plugin` and `connector` subjects in the table, which then has thirteen.
- `UPDATE: CHANGELOG.md` - the new fields, the restart mark, and the grant change as a break.

## Steps

1. Add the four row fields to the plugin channel section of `PLUGINS.md`.
2. Say in `PLUGINS.md` that the three plugin commands set `ahpd.restartNeeded` for every client.
3. Replace the `config` grants of both channels in `PLUGINS.md` with the new ones.
4. Add the `plugin` and `connector` rows to the subject table in `USERS.md`, and correct its count.
5. Add the changes to `0.14.0 - unreleased`, with the grant change under its breaks.
6. Run `pnpm -s docs:build`, and set this task and the plan row to `implemented`.

## Validation

- `PLUGINS.md` names `version`, `loaded`, `loadProblem`, `optionsSchema` and `ahpd.restartNeeded`.
- `USERS.md` lists `plugin` and `connector` with their operations.
- `CHANGELOG.md` says a role that read these channels with `config:read` now needs `plugin:read` or `connector:read`.
- `pnpm -s docs:build` passes.

## Resume

- **Done so far:** `PLUGINS.md` has a table of `version`, `loaded`, `loadProblem` and `optionsSchema`.
  It says a plugin switched off carries no schema, because its module is never imported.
  It says the three commands mark `ahpd.restartNeeded` for every connection, that nothing is pushed to a client already subscribed, and that a refusal marks nothing.
  It now names `plugin:list`, `plugin:enable`, `plugin:disable`, `plugin:options`, `connector:list`, `connector:put` and `connector:remove` in place of the `config` grants.
  `CHANGELOG.md` has the grant change under `0.14.0 - unreleased` breaks, and the four row fields and the restart mark under plugins and connectors.
  `pnpm -s docs:build` passes.
- **Next action:** the plan's final verification checklist, which is Softov's to run.
- **Open questions:** none.
- **Departures:** the `plugin` and `connector` rows, and the two counts that now say thirteen, went into `USERS.md` in task 12.
  `users.test.ts` refuses a subject with no row on that page, and task 12's gate runs it; this task checks them rather than adding them again.
  `REMOTE.md` and `HOST.md` named the old grants for `plugin list` and the plugin verbs, so both are corrected here.
  The who-may-run table splits `status` from `plugin list`, gives `plugin config`, `enable` and `disable` their grants, and leaves install, update and restart with the deployment token.
  The grants table in `HOST.md` gains `plugin:list` and `connector:list`, and says where the plugin write verbs' grants are.
- **Watch out for:** none.
