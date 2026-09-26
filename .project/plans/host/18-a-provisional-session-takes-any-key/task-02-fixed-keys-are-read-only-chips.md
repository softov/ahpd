---
title: A running session shows its fixed keys read-only
status: todo
depends: [task-01-a-fixed-key-restarts-an-unstarted-session.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L2615](../../../../packages/sdk/src/host.ts#L2615) - the `schema` handed to a backend at spawn"
  - "[code://packages/sdk/src/host.ts#L3203-L3211](../../../../packages/sdk/src/host.ts#L3203-L3211) - `sessionSchema`"
  - "[code://packages/sdk/src/host.ts#L6709](../../../../packages/sdk/src/host.ts#L6709) - `resolveSessionConfig`, which keeps `sessionSchema` unchanged"
  - "[code://packages/agent-pi/src/session.ts#L120-L133](../../../../packages/agent-pi/src/session.ts#L120-L133) - `schemaOf`, pi's own schema"
  - "[code://packages/agent-pi/src/session.ts#L439](../../../../packages/agent-pi/src/session.ts#L439) - where pi publishes it"
---

## Objective

The config schema in a running session's state marks every `sessionMutable: false` key as `sessionMutable: true, readOnly: true`, for every backend, and the new-session schema does not.

## Files

- `UPDATE: packages/sdk/src/host.ts` - a `runningSchema(agent)` over `sessionSchema(agent)` that rewrites the fixed keys, used at `spawn`'s `schema:` only.
- `UPDATE: packages/agent-pi/src/session.ts` - publish `start.schema()` when the host passes one, like cofold and the ACP bridge, so contributed keys reach a pi session.
- `UPDATE: test/session-fixed-key.test.ts` - the cases under *Validation*.

## Steps

1. Write `runningSchema`: each property with `sessionMutable === false` becomes `{ ...property, sessionMutable: true, readOnly: true }`; the rest pass through.
2. `spawn` hands `schema: () => runningSchema(agent)`. `resolveSessionConfig` and the browsed row keep `sessionSchema`.
3. The host's gate keeps `propertyOf`, which reads `sessionSchema`, so the key is still refused after the first turn.
4. Pi: if `start.schema` is present, publish it; it already carries `projectTrust` from `agent.ts`. Check the Claude, cofold and ACP sessions carry the rewrite through unchanged.
5. Leave `isolation` and `branch` alone: they reach the state through `hostSchema`, and VS Code draws them by name.

## Validation

- A running Claude session's `state.config.schema.properties.thinking` has `readOnly: true` and `sessionMutable: true`.
- With the computer plugin loaded, `computer` does too, on a Claude, cofold, ACP and pi session.
- `resolveSessionConfig` returns both keys without `readOnly`.
- A change to either after the first turn is refused.
- The published schema validates against the protocol schema.
- `pnpm test`, `pnpm typecheck`, `pnpm boundary` green.

## Resume

