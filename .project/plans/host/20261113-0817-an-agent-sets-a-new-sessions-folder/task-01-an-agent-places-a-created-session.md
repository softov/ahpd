---
title: An agent places a session a client creates
status: todo
depends: []
layer: "sdk host"
refs:
  - "[code://packages/sdk/src/types/agent.ts#L255-L340](../../../../packages/sdk/src/types/agent.ts#L255-L340) - `Start`, beside which the hook is declared on `Agent`"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L1351-L1356](../../../../packages/sdk/src/host/sessionmethods.ts#L1351-L1356) - where the folder is picked"
  - "[code://packages/sdk/src/host/automations.ts#L847-L849](../../../../packages/sdk/src/host/automations.ts#L847-L849) - keeping a trusted folder, to reuse"
  - "[code://packages/sdk/src/host/automations.ts#L1015-L1017](../../../../packages/sdk/src/host/automations.ts#L1015-L1017) - the `session:trust` refusal, to reuse"
---

## Objective

An agent with `placeSession` decides the folder, the trust, the user settings and the computer of every session a client creates on it.

## Files

- `UPDATE: packages/sdk/src/types/agent.ts` - add `placeSession?(settings, reader)` to `Agent`, answering `{ workingDirectory?, trusted?, userSettings?, computer? }`.
- `UPDATE: packages/sdk/src/host/sessionmethods.ts:1351-1356` - call the hook before the folder is picked, and use its answer.
- `UPDATE: packages/sdk/src/host/automations.ts:847-849` - share the trusted-folder write with `createSession`.
- `UPDATE: packages/sdk/src/host/automations.ts:1015-1017` - share the `session:trust` refusal with `createSession`.
- `UPDATE: docs/sdk/AGENT.md` - document the hook.
- `UPDATE: packages/sdk/test` - the cases in *Validation*.

## Steps

1. Add `placeSession` to `Agent` with a doc comment on what each field does.
2. In `createSession`, call `placeSession` with the session's config and the creator's principal.
3. Use its `workingDirectory` in place of the client's, and the client's where it answers none.
4. Refuse `trusted: true` with `-32009` naming `session:trust` when the agent's plugin lacks the grant.
5. Keep the trusted folder with `setTrustedFolder`, through the code the plugin start uses.
6. Keep `userSettings` with `setUserSettings`, as `createProviderSession` does for a plugin.
7. Put its `computer` in the session's config before `resolveCreatedSessionConfig` and `admitted` run.
8. Document the hook in `docs/sdk/AGENT.md`.

## Validation

- A test gives an agent a hook that answers a folder, trust and `userSettings: false`. A client's create runs there with both.
- A test answers a `computer`, and the session config has it before the admission check.
- A test gives the plugin no `session:trust`, and the host refuses the create, naming it.
- A test restarts the host, and the host trusts the folder again.
- A test creates a session on an agent with no hook, and the session runs in the client's folder.
- `pnpm typecheck` passes, and `pnpm vitest run packages/sdk` passes.

## Resume

