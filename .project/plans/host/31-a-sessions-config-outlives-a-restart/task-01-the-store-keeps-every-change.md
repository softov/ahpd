---
title: The store keeps what a session was made with and every change
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L8380-L8392](../../../../packages/sdk/src/host.ts#L8380-L8392) - the only write today"
  - "[code://packages/sdk/src/host.ts#L8815-L8841](../../../../packages/sdk/src/host.ts#L8815-L8841) - the live change path"
---

## Objective

A created session's config and every change the backend accepts are in the session store, as the JSON values they are, and a resume after a restart spawns with them.

## Files

- `UPDATE: packages/sdk/src/host.ts` - write `kept.setConfig` where a session is created and after a live `session/configChanged` is accepted; drop the `String()` at 8388.
- `UPDATE: packages/sdk/src/sessions.ts` - the stored `config` holds JSON values.
- `UPDATE:` the host's session store tests.

## Steps

1. Tests first with `fileSessions` in a temp folder: a session created with a config, then a new host over the same file, resumes with that config; a live change is kept the same way; an array value comes back as an array.
2. Write the store on create and on an accepted live change; keep the browsed-row path.

## Validation

- The new cases fail first and pass after.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.

## Resume
