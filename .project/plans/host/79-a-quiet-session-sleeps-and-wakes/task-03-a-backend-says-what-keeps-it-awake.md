---
title: A backend says what keeps it awake
status: todo
depends: [task-01-a-quiet-session-sleeps.md]
layer: "agent-claude, agent-acp"
refs:
  - "[code://packages/agent-claude/src/session/workers.ts#L146-L167](../../../../packages/agent-claude/src/session/workers.ts#L146-L167) - `background`, `taskInfo` and `live`, claude's background work"
  - "[code://packages/agent-claude/src/session/query.ts#L249](../../../../packages/agent-claude/src/session/query.ts#L249) - the `hooks` option, where the `Stop` hook is added"
  - "[code://packages/agent-acp/src/connection.ts#L106-L120](../../../../packages/agent-acp/src/connection.ts#L106-L120) - the ACP server process and its terminals"
  - npm://@anthropic-ai/claude-agent-sdk@0.3.278 - `StopHookInput.background_tasks` and `session_crons`
---

## Objective

A claude session answers `busy()` true while a background task runs or a CLI timer is pending.
An acp session answers `busy()` true while a terminal it opened is still running.

## Files

- `UPDATE: packages/agent-claude/src/session/query.ts:249` - add a `Stop` hook that keeps `background_tasks` and `session_crons` from its input.
- `UPDATE: packages/agent-claude/src/session/workers.ts:146-167` - expose whether a background task is live.
- `UPDATE: packages/agent-claude/src/session.ts` - `busy()` answers from the live background tasks and the kept `session_crons`.
- `UPDATE: packages/agent-acp/src/connection.ts:106-120` - `busy()` answers from the terminals that have not exited.
- `UPDATE: packages/agent-claude/test/agent-claude-background-work.test.ts` - the claude cases below.
- `UPDATE: packages/agent-acp/test/agent-acp.test.ts` - the acp case below.

## Steps

1. Write the cases first.
2. Add a `Stop` hook to the claude query options, merged with any hooks already there.
3. Keep the last `session_crons` and `background_tasks` the hook receives on the session.
4. Answer `busy()` true while a background task in `workers.ts` is live.
5. Answer `busy()` true while the kept `session_crons` list is not empty.
6. Answer `busy()` in agent-acp from the terminals that the session opened and that have not exited.
7. Leave `busy()` undefined in pi, cofold and nested; the host treats undefined as false.

## Validation

- `it('is busy while a background task runs, and not after it ends')`
- `it('is busy while the Stop hook lists a session cron')`
- `it('keeps the hooks the session already had')`
- `it('is busy while an acp terminal runs')`
- Run the full gates from the plan. All pass.

## Resume
