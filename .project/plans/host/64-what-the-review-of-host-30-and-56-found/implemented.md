---
title: What the review of host/30, host/56, daemon/13 and claude/10 found is fixed - implemented
date: 2026-10-06
refs:
  - "[code://packages/sdk/src/host/catalogue.ts](../../../../packages/sdk/src/host/catalogue.ts) - `claimedIds` and the removal loop"
  - "[code://packages/sdk/src/host/history.ts](../../../../packages/sdk/src/host/history.ts) - `drop` and the dated refresh"
  - "[code://packages/sdk/src/host/admission.ts](../../../../packages/sdk/src/host/admission.ts) - `spelled`, the string check"
  - "[code://packages/sdk/src/host/sessionmethods.ts](../../../../packages/sdk/src/host/sessionmethods.ts) - the `fetchTurns` guard"
  - "[code://packages/sdk/src/host/lifecycle.ts](../../../../packages/sdk/src/host/lifecycle.ts) - the refusal at the top of `beginOrRun`"
  - "[code://packages/server/src/commands/restart.ts](../../../../packages/server/src/commands/restart.ts) - the hold and `successorTakes`"
  - "[code://packages/server/src/commands/run.ts](../../../../packages/server/src/commands/run.ts) - the line's read, in the daemon and in check mode"
  - "[code://packages/server/src/main.ts](../../../../packages/server/src/main.ts) - the check mode"
  - "[code://packages/agent-claude/src/options.ts](../../../../packages/agent-claude/src/options.ts) - `storedSandbox`"
  - "[code://packages/agent-claude/src/session.ts](../../../../packages/agent-claude/src/session.ts) - the values a session runs on"
  - "[code://docs/DAEMON.md](../../../../docs/DAEMON.md) - what a restart checks"
---

Every bug the 2026-10-06 review of host/30, host/56, daemon/13 and claude/10 confirmed is fixed, each with a case that failed before the fix. A running session is never announced removed by a refresh, a deleted one leaves the held catalogue, a request cannot skip its gate with a channel of the wrong type, a session's turns are sent only on its own channel, an unforced restart ends no turn and leaves a daemon running when its recorded line cannot run, and a session stored with the sandbox on keeps it whatever its preset says.

## What was built

- [`code://packages/sdk/src/host/catalogue.ts`](../../../../packages/sdk/src/host/catalogue.ts) - `claimedIds()`, the id set `listing` skips, now asked by `rowsMoved` too: a refresh never sends `root/sessionRemoved` for a session this host is serving, whether it was opened from a listed row or created while the refresh was out.
- [`code://packages/sdk/src/host/history.ts`](../../../../packages/sdk/src/host/history.ts) - `drop(resource)` filters a deleted session out of the held rows and dates the delete with the pass it happened in; `refresh` filters what a pass found and what it is diffed against by that date, so a listing already in flight cannot put the row back.
- [`code://packages/sdk/src/host/admission.ts`](../../../../packages/sdk/src/host/admission.ts) - `spelled(params, ...names)`: `-32602` for a parameter that is present and is not a string. Asked for `channel` ahead of the per-method grants, and for `uri`, `source` and `destination`, the three the `file` grant reads through a `typeof === 'string'` filter.
- [`code://packages/sdk/src/host/sessionmethods.ts`](../../../../packages/sdk/src/host/sessionmethods.ts) - `fetchTurns` carries `snapshotOf`'s guard, so a terminal or file name is refused rather than sent a session's turns.
- [`code://packages/sdk/src/host/lifecycle.ts`](../../../../packages/sdk/src/host/lifecycle.ts) - `Host.refuseTurns(why)`, `ctx.refusing` and the refusal at the top of `beginOrRun`, the one road every turn takes: a turn started between a restart's check and the host closing is answered `The daemon is restarting`.
- [`code://packages/server/src/commands/restart.ts`](../../../../packages/server/src/commands/restart.ts) - `checkedRestart` takes a `hold` before the line is read and lets it go on each way a restart does not run; `successorTakes(argv)` starts the recorded entry in the check mode and refuses with the first line the child said.
- [`code://packages/server/src/commands/run.ts`](../../../../packages/server/src/commands/run.ts) - `optionsOfLine(argv, strict)` reads the recorded line with `permissive: false` in check mode, and the check is part of the line's read, so a line this code does not take refuses the restart with `Its line cannot run now, so it was not stopped:`.
- [`code://packages/server/src/main.ts`](../../../../packages/server/src/main.ts) - the check mode itself, reached by `AHPD_CHECK_LINE=1` rather than by a word, since the line it parses was written by another ahpd.
- [`code://packages/agent-claude/src/options.ts`](../../../../packages/agent-claude/src/options.ts), [`code://packages/agent-claude/src/session.ts`](../../../../packages/agent-claude/src/session.ts) - `storedSandbox(settings)` is spread over the preset where a session's values are built: a stored `sandboxEnabled` of `'on'` or `true` turns the CLI's sandbox on, and `'off'`, `'default'`, `false` or none leaves the preset in charge.
- [`code://docs/DAEMON.md`](../../../../docs/DAEMON.md) - what a restart checks before anything goes down, what it costs, and that a successor inherits the old daemon's environment and working directory.

## Verified

- Every task's case failed first, on the code standing before the fix, and passes after. The exceptions, by design: task 05's two extra cases and task 07's third case pass before and after, holding each fix in place.
- `pnpm typecheck` passes. `pnpm boundary` passes, every package `none undeclared`. `pnpm build` passes.
- `pnpm test`: 3224 passed, 1 failed of 3225. The failure is `packages/computer/test/computer-parts-mount.test.ts > asks again after a probe the image failed, and keeps a refusal of the mount type`, a `Test timed out in 5000ms` in a docker-backed file this plan does not touch. It fails the same way when that file is run on its own, and the same test timed out in full-suite runs before task 07 was built. Reported as a failure, not as a pass.
- The work is uncommitted on `c4e4dd0`.

## Departures from the plan

- Task 07 changed no assertion in `packages/sdk/test/host-sessionconfig.test.ts:531-539`, which the task's Files list named: the effect is asserted by three cases added beside it. That one is about the config values a client reads back, which this fix deliberately does not move, and the effect is about the query the CLI is built with.
- Task 06 put the line check inside the line's read in `run.ts`, after the token is read, rather than as a fifth parameter of `checkedRestart`: that read is already the thing whose throw refuses with `Its line cannot run now, so it was not stopped:`, and reading the token first keeps an unreadable line refused in this daemon's words.
- Task 03 covered `uri`, `source` and `destination` beside `channel`, beyond the one parameter the task named. They are the other three the gate reads only when they are strings and the handlers read through `String(...)`. The rest of the parameters read that way are read by no grant.
- Task 05's `users-gate-names.test.ts` needed a `WireTurn` annotation on task 04's fake transcript. Task 04's validation ran vitest and not `pnpm typecheck`, so it built on a file that did not typecheck.

## Left for later

- A session stored with the sandbox on has no control to turn it off: a new session is the way out. Named in the decision's own consequences.
- Task 06's `CHECK_WAIT_MS` bound has no case: the case that would need it is a downgrade, an entry older than `AHPD_CHECK_LINE` which serves the line instead of reading it, and there is no seam to stage one through.
- A plain `ahpd stop` has the same window an unforced restart had before task 05: `down()` awaits the plugins' `stopping` handlers before `host.close()`, and takes no hold, so a turn started there is still ended by the close. Seen while building task 05, not part of this plan.
