---
title: A login says its plan limits
status: done
depends: []
layer: "agent-claude, sdk"
refs:
  - "[code://packages/agent-claude/src/session/query.ts#L972](../../../../packages/agent-claude/src/session/query.ts#L972) - where each `rate_limit_event` arrives"
  - "[code://packages/agent-claude/src/logins.ts#L200-L209](../../../../packages/agent-claude/src/logins.ts#L200-L209) - `called`, the pattern for what a login tells the host"
  - "[code://packages/sdk/src/connectors/channel.ts#L564-L576](../../../../packages/sdk/src/connectors/channel.ts#L564-L576) - `note`, which keeps a call in the connector's health"
---

## Objective

agent-claude keeps the last plan limits of each `claude-login` connector, and sends them as `quotaSnapshots`.
They go on each turn's usage `_meta`, and into the connector's health in the host.

## Files

- `UPDATE: packages/agent-claude/src/session/query.ts:972` - give each `rate_limit_event`'s window to the login the turn uses, as well as to `limited`.
- `CREATE: packages/agent-claude/src/session/limits.ts` - the plan limits of one login, the map to `quotaSnapshots`, and the one function that calls the experimental usage request.
- `UPDATE: packages/agent-claude/src/logins.ts:200-209` - `OpenLogins` says a login's plan limits to the plugin, as `called` says a call.
- `UPDATE: packages/agent-claude/src/plugin.ts:180-184` - send the limits with `x-ahpd/connectors/note`.
- `UPDATE: packages/sdk/src/types/connectors.ts:251-259` - `ConnectorHealth` gains `quotaSnapshots`.
- `UPDATE: packages/sdk/src/connectors/channel.ts:564-576` - `note` takes an optional `quotaSnapshots`, checks its shape, and keeps it in the health.
- `CREATE: packages/agent-claude/test/agent-claude-limits.test.ts` - the map, the minute between usage requests, and a login with no plan.
- `UPDATE: packages/sdk/test/connectors-channel.test.ts` - a note with `quotaSnapshots`, and one with a bad shape.

## Steps

1. Map each window to a `quotaSnapshots` key: `five_hour` to `session`, `seven_day` to `weekly`.
2. Map `seven_day_opus`, `seven_day_sonnet` and each `model_scoped` window to `weekly:<name>`, with the name lowercased.
3. Write each snapshot with `remainingPercentage` as 100 minus `utilization`, and `resetDate` as an ISO time.
4. Map `extra_usage` to the `overage` fields when the account has credits.
5. On each `rate_limit_event`, update that one window of the turn's login.
6. After a turn ends, call the usage request with `skip_behaviors`, at most once a minute for each login.
7. Read the usage request in one function, and skip it when the method is missing or it throws.
8. Keep an empty `quotaSnapshots` for a login whose answer says `rate_limits_available` is false.
9. Put the login's `quotaSnapshots` on the turn's usage `_meta`.
10. Send the login's `quotaSnapshots` to the host through `OpenLogins`, only when it changed.
11. Let `note` take `quotaSnapshots`, refuse one that is not a map of snapshots, and keep it in the health.
12. Write the tests of *Files*.

## Validation

- `packages/agent-claude/test/agent-claude-limits.test.ts` and `packages/sdk/test/connectors-channel.test.ts` pass.
- `pnpm build`, `pnpm typecheck` and `pnpm boundary` pass, and the sdk and agent-claude tests pass.

## Resume

Done: each `rate_limit_event` updates one window of the turn's login, a turn's usage carries the login's `quotaSnapshots`, and the usage request runs after each turn at most once a minute for each login with `skipBehaviors`.
Done: `OpenLogins.noted` checks the token as `called` does, and the plugin sends the limits through `x-ahpd/connectors/note`, where `note` refuses a map that is not made of snapshots and keeps a good one in the connector's health.
Left: nothing.
Found: the SDK spells the option `skipBehaviors`, not `skip_behaviors`.
Found: an answer's `extra_usage` has no window of its own, so its overage fields ride the weekly snapshot, or the session snapshot when the week has none.
Found: `model_scoped` windows are keyed `weekly:<lowercased display name>`, and `seven_day_overage_included` keeps a window of its own.
