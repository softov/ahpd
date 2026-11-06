---
title: A refusal names the caller's way to force
status: done
depends: [task-01-the-daemon-restarts-from-a-websocket-command.md]
layer: server
refs:
  - "[code://packages/server/src/commands/restart.ts#L102](../../../../packages/server/src/commands/restart.ts#L102) - `busy`, which always says `--force`"
  - "[code://packages/server/test/server-restart.test.ts#L526-L548](../../../../packages/server/test/server-restart.test.ts#L526-L548) - the cases of the signal and the pipe, which keep `--force`"
---

## Objective

A refusal while a turn runs tells the caller how to force the restart in that caller's terms.
The websocket command and `POST /api/restart` say `force: true`.
The terminal, the signals, the control pipe and `ahpd update` keep `--force`.

## Files

- `UPDATE: packages/server/src/commands/restart.ts:102` - `busy` takes how the caller forces, with `--force` as the default.
- `UPDATE: packages/server/src/commands/restart.ts:696-735` - the HTTP surface and the websocket command pass `force: true`.
- `UPDATE: packages/server/test/host-restart-method.test.ts` - the refusal says `force: true`.
- `UPDATE: packages/server/test/server-restart.test.ts` - a case for the HTTP refusal.

## Steps

1. Give `busy` a second parameter for how the caller forces, with `--force` as the default.
2. Pass `force: true` in the websocket command and when `context.surface` is `http`.
3. Keep `--force` for the terminal, the signals, the control pipe and `selfupdate.ts`.
4. Keep the cases at `server-restart.test.ts:526-548` as they are.

## Validation

- The websocket command refuses with "pass force: true to restart anyway".
- `POST /api/restart` refuses with the same words.
- `ahpd restart` and the signal answers still say `--force`.
- `pnpm -s typecheck` passes, and the touched tests pass.

## Resume

Implemented 2026-10-30.
`busy` takes how the caller forces, with `--force` as the default. `servedRestart` passes `force: true`, so the refusal the API and AHP return names the request's own way. The terminal, the signals, the control pipe and `selfupdate.ts` call it with no second argument and keep `--force`.

- `packages/server/src/commands/restart.ts` - `busy(turning, forces)`, and `force: true` in the served check.
- `packages/server/test/host-restart-method.test.ts` - the websocket refusal says `force: true`.
- `packages/server/test/server-restart.test.ts` - `POST /api/restart` refuses with the same words; the signal and pipe cases are unchanged.
