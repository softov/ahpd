---
title: Completions offer each command once
status: done
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

- **Status:** done.
- **Done:** `completions` in [`code://packages/sdk/src/host/sessionmethods.ts`](../../../../packages/sdk/src/host/sessionmethods.ts) reads the session behind the channel. A chat gives its session's URI, and a session channel is the session itself. The backend of that session is kept for the fallback list.
- **Which list:** the client's `provider` when it names one, else the session's backend, else every backend. The root channel with no provider still answers with all of them.
- **Once each:** `offered` drops a command whose name an earlier command already has. The first is kept, and the backends are read in registration order, so the answer is stable.
- **Tests:** two cases were added to `what a slash offers` in `packages/sdk/test/host-harness.test.ts`. One asks the root channel of a host whose two Claude presets report one command. The other asks a session whose own CLI has not answered yet. Both failed before the change: the first answered two `/batch`, and the second added the other backend's `/shout`.
- **Unchanged:** every existing completion test passes as written, a client that names `provider` on the root channel included.
- **Gates:** pass. `pnpm install`, `node tools/schema.mjs`, `pnpm build`, `pnpm typecheck` and `pnpm boundary` are clean. The full `vitest` run reports 265 files and 4686 tests passed.
