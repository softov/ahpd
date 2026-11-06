---
title: The Plan call is drawn from the host
status: done
depends: []
layer: "sdk, tasks"
refs:
  - "[code://packages/agent-acp/src/mapping.ts#L399-L412](../../../../packages/agent-acp/src/mapping.ts#L399-L412) - `plan`, the Plan call drawn from ACP entries today"
  - "[code://packages/agent-acp/src/mapping.ts#L420](../../../../packages/agent-acp/src/mapping.ts#L420) - `closePlan`, which completes the call as the turn ends"
  - "[code://packages/agent-claude/src/input.ts#L307](../../../../packages/agent-claude/src/input.ts#L307) - `TodoWrite`, a row of its own in a Claude turn"
---

## Objective

A turn that changes the session's plan shows one Plan call, and its lines are the tasks of that plan in the host records.

## Files

- `UPDATE: packages/sdk/src/types/plugin.ts` - the seam through which a plugin gives the lines of the session's plan.
- `UPDATE: packages/sdk/src/host/spawn.ts` - draw the Plan call in the turn from the lines the seam gives.
- `UPDATE: packages/agent-acp/src/mapping.ts:399-412` - draw no Plan call of its own when the host draws one.
- `UPDATE: packages/agent-claude/src/session/stream.ts` - draw no `TodoWrite` row when the host draws the Plan call.
- `CREATE: packages/tasks/src/view.ts` - the lines of a plan, one per task, with its status.
- `UPDATE: packages/tasks/src/plugin.ts` - give the plan lines through the seam.
- `CREATE: packages/tasks/test/tasks-view.test.ts` - the lines of a plan.
- `CREATE: packages/agent-acp/test/agent-acp-plan.test.ts` - the Plan call in a turn, with and without the tasks plugin.

## Steps

1. Add the seam through which a plugin gives the host the lines of the session's plan.
2. Open the Plan call on the first change to the session's plan in a turn.
3. Rewrite its content with the plan lines on each later change in that turn.
4. Complete the call as the turn ends, the way `closePlan` does.
5. Write one line per task, as `- [x] <title>` for `done` and `- [ ] <title>` for the rest.
6. Keep the backend's own Plan call when no plugin gives plan lines.
7. Hold a turn's ending while a plan change from that turn is in flight, for at most two seconds, then send the row's completion and the ending in that order.
8. Announce the sessions of session-scoped plans, not only the ones a task names.

## Validation

- `packages/tasks/test/tasks-view.test.ts`: a plan with three tasks gives three lines, each with its status.
- `packages/tasks/test/tasks-view.test.ts`: a task in a session-scoped plan with no `session` field announces the session.
- `packages/agent-acp/test/agent-acp-plan.test.ts`: with the host drawing, the turn holds one Plan call, with the host lines.
- `packages/agent-acp/test/agent-acp-plan.test.ts`: with no tasks plugin, the turn holds the bridge's own Plan call.
- `packages/agent-acp/test/agent-acp-plan.test.ts`: the turn end waits for the row, and a plugin that never settles costs the two-second cap.
- `pnpm vitest run packages/tasks/test packages/agent-acp/test` passes.

## Resume

- **Done so far:** the seam is in place: `registerPlan(read)`, `planChanged(uri)` answering a promise, and `Start.plan`. `packages/tasks/src/view.ts` writes one line per task. The host opens and rewrites the turn's Plan call from the plugin's lines, and completes it as the turn ends. The ACP bridge and Claude draw their own call only where no plugin draws. The turn end is held: the tasks plugin's `plan_update` handler settles only after `planChanged`, the host tracks each `fire` promise, and an ending that arrives while one is in flight waits for the row to be drawn, or two seconds, then goes out behind the row's `chat/toolCallComplete`. Everything the backend sends after the ending waits with it. `planChanged` resolves an `ahp-session:/<id>` announcement to the session it names. `planMoved` announces the sessions of session-scoped plans as well as the ones tasks name. The `registerPlan` and `PlanReader` comments say the reader is called on `planChanged`. `packages/tasks/test/tasks-view.test.ts` passes, including the session-scoped plan announcement, and all five cases in `packages/agent-acp/test/agent-acp-plan.test.ts` pass, the cap case included.
- **Next action:** none for this task.
- **Open questions:** none. Softov chose "Host holds turn end" on 2026-10-18. How the host knows an update is in flight is the builder default in the plan's answers table: the `plan_update` handler settles after `planChanged`, and the host waits on the `fire` promise.
- **Watch out for:** the two-second cap is a fixed `PLAN_HOLD_MS` rather than `HostOptions.timer`, because that timer is shared with sleep and wakes and a fake one in a test would fire their sweeps. A turn whose plugin never settles ends late rather than never, and its row is lost only if the cap is what released it.
