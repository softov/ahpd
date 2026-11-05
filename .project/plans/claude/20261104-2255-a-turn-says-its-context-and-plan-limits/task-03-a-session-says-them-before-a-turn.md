---
title: A session says its context, plan limits and plan before a turn
status: done
depends: [task-01-a-turn-says-its-context.md, task-02-a-login-says-its-plan-limits.md]
layer: "agent-claude, sdk"
refs:
  - "[code://packages/agent-claude/src/session.ts#L168](../../../../packages/agent-claude/src/session.ts#L168) - the CLI starts when the session is made, before any turn"
  - "[code://packages/agent-claude/src/session.ts#L208-L250](../../../../packages/agent-claude/src/session.ts#L208-L250) - `sessionState`, whose `_meta` holds `ahpd.model`"
  - "[code://packages/agent-claude/src/session/query.ts#L819](../../../../packages/agent-claude/src/session/query.ts#L819) - the handshake, after which the CLI answers control requests"
  - "[code://packages/sdk/src/host/facts.ts#L206-L215](../../../../packages/sdk/src/host/facts.ts#L206-L215) - `agentMeta`, how the host reads a backend's part of the session's `_meta`"
---

## Objective

A Claude session's `_meta` holds its context, its plan limits and its plan from the handshake on, before any turn.
ahpw reads them before the first message, and each turn refreshes them.

## Files

- `UPDATE: packages/agent-claude/src/session.ts:208-250` - `sessionState()._meta` adds `contextAttribution`, `ahpd.context`, `quotaSnapshots` and `ahpd.account` beside `ahpd.model`.
- `UPDATE: packages/agent-claude/src/session/query.ts` - after the handshake, ask `accountInfo()`, the context breakdown and the plan limits, and emit `session/metaChanged`.
- `UPDATE: packages/agent-claude/src/session/limits.ts` - decide "no plan" from the account, and keep the event windows when the usage request is unavailable.
- `UPDATE: packages/agent-claude/src/logins.ts` - `OpenLogins` says a login's plan to the plugin with its limits.
- `UPDATE: packages/sdk/src/types/connectors.ts` - `ConnectorHealth` gains `account`, with `subscriptionType` and `apiProvider`.
- `UPDATE: packages/sdk/src/connectors/channel.ts` - `note` takes `account` and keeps it in the health.
- `CREATE: packages/agent-claude/test/agent-claude-session-usage.test.ts` - the session's `_meta` before a turn and after one.

## Steps

1. After the handshake, ask `accountInfo()` once, with the time limit of task 01.
2. Keep only `subscriptionType` and `apiProvider` from it, as `ahpd.account`; never keep the email or the organization.
3. After the handshake, ask the context breakdown as a turn does, and keep the last one for the session.
4. After the handshake, run `refreshLimits` as a turn's end does.
5. Put the session's last `contextAttribution`, `ahpd.context` and `quotaSnapshots` in `sessionState()._meta`.
6. Emit `session/metaChanged` when any of the four keys changes, at the handshake and after each turn.
7. Treat `rate_limits_available: false` as no answer: keep the windows the events gave.
8. Write `quotaSnapshots: {}` only for an API key or a provider other than `firstParty`, with no event window.
9. Send a login's `ahpd.account` to the host with `note`, and keep it in the connector's health as `account`.
10. Write the tests of *Files*, with a session that never runs a turn.

## Validation

- `packages/agent-claude/test/agent-claude-session-usage.test.ts` passes, and so do the limits and context tests.
- `pnpm build`, `pnpm typecheck` and `pnpm boundary` pass, and the sdk and agent-claude tests pass.

## Resume

Done: once `initializationResult()` answers, the session asks `accountInfo()`, then the context breakdown and the usage request, and sends `session/metaChanged` when the four keys moved.
Done: `sessionState()._meta` carries `contextAttribution`, `ahpd.context`, `quotaSnapshots` and `ahpd.account` beside `ahpd.model`, and each turn's end refreshes them.
Done: `rate_limits_available: false` keeps the events' windows, and only an account with no plan gets `{}`.
Done: a login's account goes to the host with its limits through `x-ahpd/connectors/note`, and the connector's health keeps it as `account`.
Left: nothing.
Found: the `init` frame of step 1's ref comes only with a turn, so the handshake is `initializationResult()`, which the CLI answers at startup.
Found: `sayUsage` was already a name on the session context, so the new emitter is `sayMeta`.
