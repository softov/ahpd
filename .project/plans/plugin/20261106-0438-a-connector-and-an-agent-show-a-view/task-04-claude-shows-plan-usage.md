---
title: Claude shows plan usage
status: done
depends: [task-03-a-data-event-sets-a-value.md]
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/adapter.ts#L93-L95](../../../../packages/agent-claude/src/adapter.ts#L93-L95) - the `claude-login` adapter's capabilities and `open`"
  - "[code://packages/agent-claude/src/plugin.ts#L117-L150](../../../../packages/agent-claude/src/plugin.ts#L117-L150) - the Claude engine and its `open`"
  - "[code://packages/agent-claude/src/logins.ts#L161-L232](../../../../packages/agent-claude/src/logins.ts#L161-L232) - `onLimits` and `noted`, where a plan answer arrives"
  - "[code://packages/agent-claude/src/session/limits.ts#L281](../../../../packages/agent-claude/src/session/limits.ts#L281) - `publish`, which sends a changed plan"
  - "[code://packages/sdk/src/types/connectors.ts#L268-L275](../../../../packages/sdk/src/types/connectors.ts#L268-L275) - the plan fields of the connector health, which go"
  - git://fffec0bc - #248's `ui.ts`, whose window and login builders move to `views.ts`
---

## Objective

A `claude-login` connector shows its plan and each window of it on its `main` view.
A Claude agent shows the same for each login its record names.
A plan answer changes the data with `setViewData`, and the connector health has no plan fields.

## Files

- `CREATE: packages/agent-claude/src/views.ts` - `LOGIN_VIEW`, `AGENT_VIEW`, and the data each one shows.
- `DELETE: packages/agent-claude/src/ui.ts` - #248's schemas, which become the views of `views.ts`.
- `UPDATE: packages/agent-claude/src/adapter.ts:93-95` - a `view` capability named `main`, and `open` passes the handle on.
- `UPDATE: packages/agent-claude/src/plugin.ts:117-150` - the same capability on the engine, and `open` passes the handle on.
- `UPDATE: packages/agent-claude/src/logins.ts:161-232` - each login and agent keeps its handle, and a plan answer sets their data.
- `UPDATE: packages/agent-claude/src/session/limits.ts:281` - the doc of `publish` says where the plan goes.
- `UPDATE: packages/sdk/src/types/connectors.ts:268-275` - the plan fields of the health go, as #248 removed them.
- `UPDATE: packages/sdk/src/connectors/channel.ts` - `x-ahpd/connectors/note` takes no plan fields, as #248 changed it.
- `CREATE: packages/agent-claude/test/agent-claude-views.test.ts` - the cases of #248's `agent-claude-ui.test.ts`, for views.
- `DELETE: packages/agent-claude/test/agent-claude-ui.test.ts` - its cases move to `agent-claude-views.test.ts`.
- `UPDATE: packages/agent-claude/test/agent-claude-login-adapter.test.ts` - the `view` capability and the handle.

## Steps

1. Move the window and login builders of `ui.ts` into `views.ts`, and remove `ui.ts`.
2. Make `LOGIN_VIEW` a `PluginView` whose props bind to `/plan` and `/windows`.
3. Make `AGENT_VIEW` a `PluginView` whose list binds to `/logins`.
4. Declare `{ type: 'view', name: 'main' }` on the `claude-login` adapter and on the Claude engine.
5. At a login's `open`, call `showView` with `LOGIN_VIEW` and the data its account last gave.
6. At an agent's `open`, call `showView` with `AGENT_VIEW` and the logins its record names.
7. On each plan answer, call `setViewData` on the login's handle.
8. On each plan answer, call `setViewData` on each open agent that names that login.
9. Keep the plan fields out of `ConnectorHealth` and out of `x-ahpd/connectors/note`.

## Validation

- `agent-claude-views.test.ts`: a login's `open` shows its plan and windows.
- `agent-claude-views.test.ts`: a plan answer sends `setViewData` to the login and to each agent that names it.
- `agent-claude-views.test.ts`: an agent shows only the logins its record names, in their order.
- `agent-claude-login-adapter.test.ts`: the adapter declares a `view` capability named `main`.
- `pnpm typecheck` passes.
- `pnpm exec vitest run packages/agent-claude/` and `pnpm exec vitest run packages/sdk/` pass, one at a time.
- By hand, after Softov restarts the daemon: a `claude-login` connector and a Claude agent show the view after a turn.

## Resume

Done. `views.ts` holds `LOGIN_VIEW`, `AGENT_VIEW` and the data builders, and `ui.ts` is removed.
The `claude-login` adapter and the Claude engine declare `{ type: 'view', name: 'main' }`.
A login shows its view at its open, and a plan answer sets `/` of its data.
An agent shows its view at its open, and a plan answer for a login it names sets `/logins`.

Verified: `pnpm exec vitest run packages/agent-claude/` passes 595 tests.

Found: `agent-claude-limits.test.ts` and `agent-claude-session-usage.test.ts` changed, beside the task's *Files*, because their fake handle had `show`.

After Softov's test on 2026-11-06, the login's view shows the account's email masked, and the plan line shows only a plan type.
`maskedEmail` in `session/limits.ts` masks it, and the plan keeps it apart from `ahpd.account`.
A setup token names no plan type, and its windows come from rate limit events, which may carry no utilization.

Each window row carries `extra`, `extraUsed` and `extraCap` when the account has extra usage, and draws the credits spent and the cap.
`OpenLogins` keeps the last plan answer past a stop, with its token, so a reopen with the same token shows it again.

Left: Softov checks the view again after this change, with a daemon.
`OpenLogins` keeps a closed agent's entry, as `deferred.md` says.
