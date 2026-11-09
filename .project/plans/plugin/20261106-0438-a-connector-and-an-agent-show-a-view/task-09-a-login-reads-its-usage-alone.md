---
title: A login reads its usage alone
status: done
depends: [task-07-a-login-asks-the-profile-scope.md]
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/usage.ts](../../../../packages/agent-claude/src/usage.ts) - `usageOf` and `snapshotsOf`"
  - "[code://packages/agent-claude/src/adapter.ts](../../../../packages/agent-claude/src/adapter.ts) - the read at open and at each check"
  - npm://@anthropic-ai/claude-agent-sdk@0.3.301 - `usage_report` on the assistant message of `/usage`, in the SDK since 0.3.273
---

## Objective

A login whose profile answered reads its plan usage with one `/usage` query, at its open and at each check.
Its view shows each window's share and reset time before any session runs.

## Files

- `CREATE: packages/agent-claude/src/usage.ts` - `usageOf`, the one-shot read, and `snapshotsOf`, the report's rows as the plan's windows.
- `UPDATE: packages/agent-claude/src/adapter.ts` - the read after the profile at open, and at each check.
- `UPDATE: packages/agent-claude/src/logins.ts` - `measured`, which sets the windows of a read.
- `CREATE: packages/agent-claude/test/agent-claude-usage-report.test.ts` - the read and the mapping.
- `UPDATE: packages/agent-claude/test/agent-claude-login-adapter.test.ts` - the read at open.

## Steps

1. Run `query` with the prompt `/usage`, `maxTurns: 1`, no settings and no saved session.
2. Give it the login's token and scopes, without the daemon's keys and cloud switches.
3. Keep the `usage_report` of the assistant message, and stop after 30 seconds.
4. Map each row to a window: `session`, `weekly_all` as `weekly`, and a scoped row by its display name.
5. Read the usage after the profile answers at open, and at each check.

## Validation

- `agent-claude-usage-report.test.ts`: the read starts the CLI on the token and scopes alone, and keeps no session.
- `agent-claude-usage-report.test.ts`: a result with no report, and a CLI that fails, give nothing.
- `agent-claude-usage-report.test.ts`: the rows map to the plan's windows, with extra usage on the weekly one.
- `agent-claude-login-adapter.test.ts`: an open reads the usage after the profile and shows each window.
- `pnpm exec vitest run packages/agent-claude/` passes.
- By hand: a login's view shows its windows before any session.

## Resume

Done. `usageOf` and `snapshotsOf` are in `usage.ts`, and the adapter reads the usage at open and at each check.
`pnpm exec vitest run packages/agent-claude/` passes 609 tests.

Left: Softov's check by hand.
