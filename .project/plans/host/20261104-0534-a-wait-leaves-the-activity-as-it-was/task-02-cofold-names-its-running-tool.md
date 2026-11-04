---
title: cofold names its running tool
status: todo
depends:
  - task-01-no-agent-says-waiting-on-you.md
layer: "agent-cofold"
refs:
  - "[code://packages/agent-cofold/src/mapping.ts#L49-L56](../../../../packages/agent-cofold/src/mapping.ts#L49-L56) - `MappedEvent`, which gets the `doing` field"
  - "[code://packages/agent-cofold/src/mapping.ts#L691-L760](../../../../packages/agent-cofold/src/mapping.ts#L691-L760) - `tool.started`, `tool.completed` and `tool.denied`"
  - "[code://packages/agent-cofold/src/runs.ts#L105-L106](../../../../packages/agent-cofold/src/runs.ts#L105-L106) - `apply`, which says the activity"
  - "[code://packages/agent-claude/src/session/parts.ts#L57-L61](../../../../packages/agent-claude/src/session/parts.ts#L57-L61) - `busyWith`, the shape of the line"
  - "[code://packages/agent-claude/src/session/stream.ts#L579-L581](../../../../packages/agent-claude/src/session/stream.ts#L579-L581) - Claude goes back to `Thinking` when a tool completes"
---

## Objective

While a cofold tool runs, the activity names it, as `<displayName> <subject>`.
When the tool completes or is denied, the activity is `Thinking`.
A live run and a replayed run say the same lines.

## Files

- `UPDATE: packages/agent-cofold/src/mapping.ts:49-56` - add `doing?: string` to `MappedEvent`: the activity this event says.
- `UPDATE: packages/agent-cofold/src/mapping.ts:691-760` - return `doing` on `tool.started`, `tool.completed` and `tool.denied`.
- `UPDATE: packages/agent-cofold/src/runs.ts:105-140` - in `apply`, say `mapped.doing` when it is set.
- `UPDATE: packages/agent-cofold/test/agent-cofold-tools.test.ts` - add the cases for a tool that completes and a tool that is denied.
- `UPDATE: packages/agent-cofold/test/agent-cofold-approval.test.ts` - add the case for an approved tool.

## Steps

1. Add `doing?: string` to `MappedEvent`, with a comment that says what it is.
2. On `tool.started`, return `doing` as the call's display name and its subject, joined by a space.
3. Use the display name alone when the call has no subject.
4. Collapse whitespace in the line, and cut it to 80 characters, as `busyWith` does.
5. On `tool.completed` and `tool.denied`, return `doing` as `Thinking`.
6. In `apply`, call `ctx.activity.say(mapped.doing)` when `mapped.doing` has a value.
7. Keep the clear on `run.finished`, so a finished run still says no activity.
8. Add a test that reads the tool line on `tool.started`, and `Thinking` after `tool.completed`.
9. Add a test that reads `Thinking` after `tool.denied`.
10. Add a test that reads the tool line on an approved call when it starts.

## Validation

- The new cases pass in agent-cofold.
- `pnpm build`, `pnpm typecheck` and `pnpm boundary` pass.
- `pnpm --filter @ahpd/agent-cofold test` passes from the repository root.

## Resume
