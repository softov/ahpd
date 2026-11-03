---
title: A client's action is said as sent - implemented
date: 2026-11-03
refs:
  - git://0f13d0b0 - the change
  - "[code://packages/sdk/src/host/chatactions.ts](../../../../packages/sdk/src/host/chatactions.ts)"
  - "[code://packages/sdk/src/host/actions.ts](../../../../packages/sdk/src/host/actions.ts)"
  - "[code://packages/sdk/src/host/sessionconfig.ts](../../../../packages/sdk/src/host/sessionconfig.ts)"
  - "[code://packages/sdk/src/types/session.ts](../../../../packages/sdk/src/types/session.ts)"
---

A customization switch, a root push naming the restart mark, and a config change are each said as the client sent them.
`setConfig` answers `true` or a sentence, and what goes out is in the client's own keys.
A running session's schema is each key as its backend or plugin declared it, with no read-only chip drawn over a fixed key.

## What was built

- [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts) - the switch's echo, and `taking`.
- [`code://packages/sdk/src/host/actions.ts`](../../../../packages/sdk/src/host/actions.ts) - the root push's echo.
- [`code://packages/sdk/src/types/session.ts`](../../../../packages/sdk/src/types/session.ts) - `ConfigTaken` and `setConfig`'s contract.
- [`code://packages/sdk/src/host/sessionconfig.ts`](../../../../packages/sdk/src/host/sessionconfig.ts) - `runningSchema`.
- [`code://docs/sdk/AHP.md`](../../../../docs/sdk/AHP.md), [`code://docs/sdk/AGENT.md`](../../../../docs/sdk/AGENT.md) and [`code://docs/sdk/HOST.md`](../../../../docs/sdk/HOST.md) - the rows that described each echo.

## Verified

- On `cde4dd6c`'s sources each changed case fails: the switch echoed as a session decision, the stale mark echoed true.
- On the same sources an answer under the backend's keys goes out, and a fixed key and a contributed one read as read-only chips.
- With the change the tools file passes 83 of 83, root config 34 of 34, and session config 33 of 33.
- Fixed keys pass 19 of 19, client plugins 14 of 14, and the harness file 50 of 50.
- `pnpm run typecheck` and `pnpm run boundary` report no errors.

## Departures from the plan

- None.
