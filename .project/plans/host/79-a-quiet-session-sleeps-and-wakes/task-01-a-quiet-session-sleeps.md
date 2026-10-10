---
title: A quiet session sleeps
status: todo
depends: []
layer: "sdk host, server"
refs:
  - "[code://packages/sdk/src/host/state.ts#L12-L41](../../../../packages/sdk/src/host/state.ts#L12-L41) - `Held`, which gains `quietSince`"
  - "[code://packages/sdk/src/host/lifecycle.ts#L538-L700](../../../../packages/sdk/src/host/lifecycle.ts#L538-L700) - `restart`, the close path `sleep` follows"
  - "[code://packages/sdk/src/host/catalogue.ts#L157-L172](../../../../packages/sdk/src/host/catalogue.ts#L157-L172) - `running`, one of the things that keep a session awake"
  - "[code://packages/sdk/src/types/session.ts#L308](../../../../packages/sdk/src/types/session.ts#L308) - `resumable?()`, false means never sleep"
  - "[code://packages/sdk/src/types/host.ts#L70](../../../../packages/sdk/src/types/host.ts#L70) - `HostOptions`, which gains `sleepAfterMinutes`"
  - https://github.com/microsoft/vscode/blob/main/src/vs/platform/agentHost/node/agentSessionResidency.ts - the count limit, the recency order and what blocks a release
  - "[code://packages/server/src/commands/options.ts#L470-L490](../../../../packages/server/src/commands/options.ts#L470-L490) - the option catalogue, in the pattern of `automations`"
---

## Objective

A live session with nothing in hand closes its agent after `sleepAfterMinutes` of quiet, 30 by default.
It also closes when more than `sessionResidencyLimit` sessions are loaded, 10 by default, the least recently used first.
An archived session closes at once.
It stays in the catalogue with its chats, rule state, automations and terminals, the same as after a daemon restart.

## Files

- `UPDATE: packages/sdk/src/host/state.ts:12-41` - add `quietSince` to `Held`.
- `UPDATE: packages/sdk/src/types/session.ts:308` - add `busy?(): boolean` beside `resumable?()`, which says the backend has work the host cannot see.
- `UPDATE: packages/sdk/src/types/host.ts:70` - add `sleepAfterMinutes?: number`, 30 when absent, and `sessionResidencyLimit?: number`, 10 when absent; 0 turns each off.
- `CREATE: packages/sdk/src/host/sleep.ts` - `quiet(held)`, `sleep(uri)`, the recency order and the sweep.
- `UPDATE: packages/sdk/src/host.ts` - move `quietSince` at the dispatch funnel; start the sweep in `createHost` and stop it in `Host.close`.
- `UPDATE: packages/server/src/commands/options.ts` - the `sleepAfterMinutes` and `sessionResidencyLimit` options with their descriptions.
- `UPDATE: packages/server/src/config.ts` - read both options and pass them to the host.
- `CREATE: packages/sdk/test/session-sleep.test.ts` - the cases below.

## Steps

1. Write the cases in `session-sleep.test.ts` first, with an injectable clock in the pattern of `scheduled.ts`.
2. Set `quietSince` at the spawn or resume of a session.
3. Move `quietSince` on every action the session emits or receives at the dispatch funnel in `host.ts`.
4. Do not move `quietSince` for a client subscribe or unsubscribe.
5. Order the live sessions by their last turn start, as VS Code's `AgentSessionResidency` orders them.
6. In `quiet(held)`, answer false for a running or queued turn, from `running` in catalogue.ts.
7. In `quiet(held)`, answer false for a pending tool confirmation or a pending input request on any chat.
8. In `quiet(held)`, answer false when `resumable()` answers false or `busy()` answers true.
9. In `quiet(held)`, answer false while a client subscription names the session or one of its chats.
10. In `sleep(uri)`, call `chat.close(false)` on each chat, then `sessions.delete(uri)`, as `restart` does.
11. Do not call `teardown`: keep terminals, subagent records, rule state and automation runs.
12. Publish `root/activeSessionsChanged` after a sleep.
13. Run the sweep each minute and sleep each live session that is quiet for longer than `sleepAfterMinutes`.
14. Run the sweep on each turn start, and sleep the least recently used sessions over `sessionResidencyLimit` that `quiet` allows.
15. Sleep an archived session at once when `quiet` allows it.
16. Skip the timeout when `sleepAfterMinutes` is 0, and the count limit when `sessionResidencyLimit` is 0.
17. Add both options to the server options and config, and pass them to `createHost`.

## Validation

- `it('sleeps a session quiet for longer than the timeout')`
- `it('keeps a session awake while a turn runs or a message is queued')`
- `it('keeps a session awake while a tool confirmation or an input request waits')`
- `it('keeps a session awake when resumable answers false')`
- `it('keeps a session awake when busy answers true')`
- `it('does not count a client subscribe as activity')`
- `it('keeps a session awake while a client is subscribed to it')`
- `it('sleeps the least recently used quiet session over the count limit')`
- `it('sleeps an archived session at once')`
- `it('closes each chat with close(false), and keeps its terminals and rule state')`
- `it('lists a sleeping session in the catalogue and not as active')`
- `it('never sleeps with sleepAfterMinutes 0 and sessionResidencyLimit 0')`
- Run the full gates from the plan. All pass.

## Resume
