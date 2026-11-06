---
title: Claude shows plan usage
status: implemented
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

Done. `packages/agent-claude/src/ui.ts` holds the two schemas and the builders. `LOGIN_UI` is a Column of the plan type and a List of window rows, and `AGENT_UI` is a List of login rows, each with its name, its plan and the same window rows. `loginDataOf` builds `{ plan?, windows }` from a login's last `PlanNote`, and `agentDataOf` builds `{ logins: [{ name, plan?, windows }] }` for each login a record names. A window's name is its key in title case (`Session`, `Weekly: opus`), `left` is its `remainingPercentage` and `reset` its `resetDate`.

`adapter.ts` declares `LOGIN_UI` as the adapter's `ui` capability and passes the handle `open` is handed to `logins.opened`. `plugin.ts` declares `AGENT_UI` as the engine's `ui` capability and has `open` keep each agent's handle and record before building the backend. `OpenLogins` keeps each open login's handle and last plan answer, and each open agent's handle and record. `noted` draws the answer on the login's ui and, for each open agent whose record names that login now, draws the agent's data again. `publish` is unchanged in what it sends and only its doc says the ui is where it goes. `onLimits` and the plugin's `throughHost.onLimits` are gone, since nothing notes a plan to the host any more. `ConnectorHealth` no longer has `quotaSnapshots` or `account`; `note` takes `{ id, ok, status?, error? }`, and the command refuses a note with no `ok`.

Verified: `pnpm exec tsc -p tsconfig.json --noEmit` printed nothing, `pnpm boundary` reported every package with none undeclared, `pnpm exec vitest run packages/sdk/` passed 226 files with 4288 tests and 4 skipped, and `pnpm exec vitest run packages/agent-claude/` passed 61 files with 587 tests. `pnpm -s schema` ran first, and the two sdk cases of a note with `quotaSnapshots` or `account` are gone.

Found: the host gives an engine no hook when a record changes, so step 10 reads the record's `logins` at each send instead. The agents channel fills the same view object again on an edit, so the next plan answer for a login the record names builds the new list; a record that stops naming a login changes at the next answer for a login it still names. `adapter.ts` is not in the task's Files but is where the adapter is built, so its capability and its `open` are declared there.

Left: by hand, a daemon with a `claude-login` connector and a Claude agent, and the two rows' `ui` after a turn, wait for Softov: this task starts no daemon. An agent's handle is kept by `OpenLogins` until the id opens again or the plugin unloads; a removed agent's handle writes nothing, as task 02 holds.