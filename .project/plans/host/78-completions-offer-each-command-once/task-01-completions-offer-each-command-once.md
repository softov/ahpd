---
title: Completions offer each command once
status: todo
depends: []
layer: sdk
refs:
  - "[code://packages/sdk/src/host/sessionmethods.ts#L364-L376](../../../../packages/sdk/src/host/sessionmethods.ts#L364-L376) - `wide`, `offered` and the sort"
  - "[code://packages/sdk/test/host-harness.test.ts#L319-L338](../../../../packages/sdk/test/host-harness.test.ts#L319-L338) - a root-channel completion test to copy"
---

## Objective

`completions` gives each slash command once, and a session falls back to its own provider's commands.

## Files

- `UPDATE: packages/sdk/src/host/sessionmethods.ts:285-376` - keep the session's provider, use it for `wide`, and remove repeated names from `offered`.
- `UPDATE: packages/sdk/test/host-harness.test.ts` - two providers with the same command, on the root channel and in a new session.

## Steps

1. Get the provider of the session that the channel resolves to, from its URI or its `agent.provider`.
2. Use `params.provider` when it names an agent, else the session's provider, else every agent.
3. Remove a command from `offered` when an earlier command has the same name.
4. Add a test: two providers report `/batch`, and the root channel gives one `/batch`.
5. Add a test: a new session with no customizations gives its own provider's commands only.

## Validation

- Both new tests pass, and the existing completion tests pass unchanged.
- `pnpm test` passes.

## Resume

- **Done so far:** nothing.
- **Next action:** step 1.
