---
title: The docs say how to update
status: done
depends:
  - task-03-update-installs-moves-plugins-and-restarts.md
  - task-04-ahp-calls-the-update.md
  - task-05-windows-installs-after-the-daemon-stops.md
layer: docs
refs:
  - "[code://docs/server/UPGRADE.md](../../../../docs/server/UPGRADE.md) - the upgrade by hand"
---

## Objective

`docs/server/UPGRADE.md` starts at `ahpd update`, and keeps the three commands for an install that the update refuses.

## Files

- `UPDATE: docs/server/UPGRADE.md` - `ahpd update` first, then `--check`, `--version`, `--force`, and what is refused.
- `UPDATE: docs/server/RUN.md` - one line that points to the update.

## Steps

1. Put `ahpd update` at the top of `UPGRADE.md`.
2. Write what `--check`, `--version` and `--force` do.
3. List the refusals: a checkout, a link, a daemon in the foreground, a running turn and an unfit plugin.
4. Keep the three commands by hand for a refused install.
5. Say that over HTTP and AHP only the deployment token updates.
6. Run `lint-prose.mjs` on the changed files.
7. Set this task and the plan row to `implemented`.

## Validation

- The docs build passes.
- `lint-prose.mjs` prints nothing for the changed files.

## Resume

Done 2026-10-19. Every step is built, and both cases the Validation names pass. Not reviewed.

`docs/server/UPGRADE.md` starts with `ahpd update`. A table follows for `--check`, `--version` and `--force`, and a numbered "What it does" covers the install, the plugin move and the restart. "Refusals" lists the five with one line each, and says the daemon keeps running and `--check` answers the same refusal as `why`. "HTTP and AHP" says only the deployment token may update. A person's token is refused with 403, and a person's AHP call with `-32009`. A curl for `POST /api/update` is given there. "Windows" says the answer comes first, the daemon stops, and the helper installs and starts it again from `daemon.log`. The three commands by hand stay under "By hand", followed by the 0.6 warning and "Update check" as they were. `docs/server/RUN.md` gains one row in its command table that points at `UPGRADE.md`.

Departures:
- `docs/server/REMOTE.md`'s "Who may run what" table names `ahpd update` in the deployment-token-only row. The task named two files, and this row is where a reader looks for what a person may call.
- `lint-prose.mjs` reports two long sentences in `RUN.md` and `REMOTE.md`. Both are lines this task did not change, so they were left as they were; memory says a pre-existing plan line reports the same way.
- The `0.13.0` in the `--version` row is an example, chosen above this package's `0.12.0`. The docs name no real target version anywhere else.

The docs build passes, with only the existing chunk-size warning. `lint-prose.mjs` prints nothing for `UPGRADE.md`, and the two findings above for the other two files.
