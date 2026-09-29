---
title: ACP tool calls carry their start and end while the daemon runs
status: todo
depends: []
layer: "agent-acp"
refs:
  - "[code://packages/agent-acp/src/session.ts#L281-283](../../../../packages/agent-acp/src/session.ts#L281-283) - raw `updates` stored with no receive time"
  - "[code://packages/agent-acp/src/agent.ts#L96-104](../../../../packages/agent-acp/src/agent.ts#L96-104) - the transcript is in memory and lost on restart"
---

## Objective

The plugin stamps the receive time of a call's first `tool_call` as start and of the update that ends it as end, and keeps them with the stored updates so the in-memory transcript has them. ACP has no time of its own; a call replayed by `session/load` after a restart carries no times, since its receive time is the replay's.

## Steps

1. Failing first: the cases under Validation.
2. Stamp through the sdk helper from p1.

## Validation

- A call carries the three keys live and in a re-subscribe before a restart.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.
