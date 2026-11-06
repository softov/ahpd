---
title: Claude shows plan usage
status: todo
depends: [task-02-the-rows-carry-a-uis-data.md]
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/plugin.ts#L203-L204](../../../../packages/agent-claude/src/plugin.ts#L203-L204) - where the `claude-login` adapter and the Claude engine are registered"
  - plans/claude/20261104-2255-a-turn-says-its-context-and-plan-limits/plan.md - the plan usage this task shows; its `PlanNote` and `quotaSnapshotsOf` are on main since #243
---

## Objective

A `claude-login` connector shows its plan usage, and a Claude agent shows the plan usage of each of its logins.
agent-claude declares both schemas and sends the data; the connector health no longer holds the plan.

## Files

- `CREATE: packages/agent-claude/src/ui.ts` - the two schemas, and the functions that build each one's data.
- `UPDATE: packages/agent-claude/src/logins.ts` - `PlanNote` goes to the login's ui instead of its connector health.
- `UPDATE: packages/agent-claude/src/session/limits.ts` - `publish` sends the plan to the ui of the login and of each agent that uses the login.
- `UPDATE: packages/agent-claude/src/plugin.ts:203-204` - the adapter and the engine declare their `ui` capability, and `open` keeps each handle.
- `UPDATE: packages/sdk/src/types/connectors.ts` - `ConnectorHealth` loses `quotaSnapshots` and `account`, which #243 added.
- `UPDATE: packages/sdk/src/connectors/channel.ts` - `note` stops taking `quotaSnapshots` and `account`.
- `UPDATE: packages/sdk/test/connectors-channel.test.ts` - the cases of a note with `quotaSnapshots` or `account` go.
- `UPDATE: packages/agent-claude/test/agent-claude-login-adapter.test.ts` - the connector's schema and data.
- `CREATE: packages/agent-claude/test/agent-claude-ui.test.ts` - the agent's data for one and two logins.

## Steps

1. Write the login schema: the plan type, then one row for each window.
2. Give each window row its name, the percent left and the reset time.
3. Write the agent schema: a list over its logins, each with its name and the same window rows.
4. Build the login data from the login's last plan answer.
5. Build the agent data from the record's `logins` and each login's last plan answer.
6. Declare the login schema as a `ui` capability of the `claude-login` adapter.
7. Declare the agent schema as a `ui` capability of the Claude engine.
8. Keep the handle that `open` hands for each login and each agent.
9. When a plan answer arrives, send the login's data, then the data of each open agent that names that login.
10. Send the agent's data again when its record's `logins` change.
11. Remove `quotaSnapshots` and `account` from `ConnectorHealth`, and stop writing them.

## Validation

- `agent-claude-login-adapter.test.ts`: the adapter registers with its `ui` capability.
- `agent-claude-login-adapter.test.ts`: a plan answer sends the login's data.
- `agent-claude-login-adapter.test.ts`: a login with no plan sends an empty list of windows.
- `agent-claude-ui.test.ts`: an agent with one login gets one entry, and an agent with two gets two.
- `agent-claude-ui.test.ts`: a plan answer for one login changes only the agents that name it.
- `pnpm --filter @ahpd/agent-claude test`, `pnpm --filter @ahpd/sdk test` and `pnpm typecheck` pass.
- By hand: run a daemon with a `claude-login` connector and a Claude agent.
- By hand: after a turn, check that both rows carry `ui` with the plan.

## Resume

