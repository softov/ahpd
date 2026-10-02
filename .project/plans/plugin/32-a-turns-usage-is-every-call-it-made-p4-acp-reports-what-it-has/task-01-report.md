---
title: ACP reports what it has
status: todo
depends: []
layer: "agent-acp"
refs:
  - "[code://packages/agent-acp/src/mapping.ts#L219-L227](../../../../packages/agent-acp/src/mapping.ts#L219-L227) - the dropped variant"
  - "[code://packages/agent-acp/src/session.ts#L737-L738](../../../../packages/agent-acp/src/session.ts#L737-L738) - the prompt response"
---

## Objective

A `usage_update` with a `cost` sends `chat/usage` with the turn's cost so far; the prompt response's `usage`, when present, sends the turn's tokens with it.

## Files

- `UPDATE: packages/agent-acp/src/mapping.ts:219-227` - map `usage_update` with a `cost` to `chat/usage`, cost minus the value at turn start.
- `UPDATE: packages/agent-acp/src/session.ts:737-738` - read `response.usage` into the final `chat/usage`, keeping the cost.

## Steps

1. Remember the session's cumulative cost when a turn starts.
2. Drop the "a usage report" mention from the comment listing what is not carried.

## Validation

- new `packages/agent-acp/test/agent-acp-usage.test.ts`: two `usage_update`s in a turn send the cost difference; a prompt response with `usage` sends tokens and cost; one without sends cost only.
- `pnpm -F @ahpd/agent-acp test`.

## Resume
