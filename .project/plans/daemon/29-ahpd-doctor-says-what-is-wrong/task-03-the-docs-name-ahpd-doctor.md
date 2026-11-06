---
title: The docs name ahpd doctor
status: done
depends: [task-02-ahpd-doctor-prints-the-checks.md]
layer: docs
refs:
  - "[code://docs/server/RUN.md](../../../../docs/server/RUN.md) - the table of daemon commands, where `ahpd status` is"
  - "[code://CHANGELOG.md](../../../../CHANGELOG.md) - the 0.14.1 section"
---

## Objective

The Run page names `ahpd doctor`, its checks and its exit code, and the changelog names the command.

## Files

- `UPDATE: docs/server/RUN.md` - add `ahpd doctor` to the table, and a section with the checks in order and the exit code.
- `UPDATE: CHANGELOG.md` - add one line for `ahpd doctor` to the 0.14.1 section.

## Steps

1. Add the row `ahpd doctor` with "Say what is wrong, and how to fix it" below `ahpd status`.
2. Write a section that lists the seven checks in order, with one line each.
3. Say that `--json` is the output for a support ticket, and that it holds no token.
4. Say that the exit code is 1 when a check is `fail`.
5. Add the changelog line to the 0.14.1 section.

## Validation

- `pnpm -s docs:build` passes.
- The section lists the same checks in the same order as `checks` in `packages/server/src/doctor.ts`.

## Resume

- **Done so far:** steps 1 to 5, 2026-10-27. `docs/server/RUN.md` has the `ahpd doctor` row below `ahpd status`, and a Doctor section before Service. The section lists the seven checks in the order `checks` runs them, with the result each one gives and the fix line. It says `--json` is the output for a support ticket and holds no token. It says the exit code is 1 when a check is `fail`. `CHANGELOG.md` has the line in the 0.14.1 Daemon section. `pnpm -s docs:build` passes.
- **Next action:** none. The three tasks are implemented, and the plan waits on its final verification checklist.
- **Open questions:** none.
- **Watch out for:** the Doctor section repeats the order of `ORDER` in `packages/server/src/doctor.ts`. A check that moves is a change in both places.
