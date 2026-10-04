---
title: The query runs on the picked agent
status: done
depends: [task-01-the-picked-agent-reaches-the-backend.md, task-02-built-in-agents-are-listed-as-vscode-lists-them.md]
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/session.ts#L2180-L2243](../../../../packages/agent-claude/src/session.ts#L2180-L2243) - `beginTurn`"
  - "[code://packages/agent-claude/src/session.ts#L2009-L2153](../../../../packages/agent-claude/src/session.ts#L2009-L2153) - `query()`"
  - https://github.com/microsoft/vscode/blob/832cf23c588/src/vs/platform/agentHost/node/claude/customizations/claudeSessionCustomizationDiscovery.ts#L206-L252 - `resolveClaudeAgentName`
  - https://github.com/microsoft/vscode/blob/832cf23c588/src/vs/platform/agentHost/node/claude/claudeAgentSession.ts#L730-L771 - the rebuild
---

## Objective

A message's agent uri resolves to the SDK agent name and is passed as `query({ agent })`; a send whose agent differs from the running query's closes it and resumes the same session with the new one before the turn starts.

## Files

- `UPDATE: packages/agent-claude/src/session.ts` - an `agentNameOf(uri)` beside `customizationsOf`; `agent` in the `query()` options; the rebuild in `beginTurn` and `queue`.
- `CREATE: packages/agent-claude/test/agent-claude-agent-pick.test.ts` - the cases below.

## Steps

1. Tests first with the faked SDK: a first message with `Plan` starts `query` with `agent: 'Plan'`; a second with the same agent does not restart; a third with none restarts with no `agent` and resumes the same session id; a `file:` uri whose frontmatter says `name: reviewer` gives `reviewer`; a missing file gives its basename; `claude-internal:/agent/Explore` gives `Explore`.
2. Implement the name, then the option, then the rebuild through the resume path the session already has.

## Validation

- The new cases fail first and pass after.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.
- By hand in ahpapp: pick an agent, send, and the turn runs on it.

## Resume
