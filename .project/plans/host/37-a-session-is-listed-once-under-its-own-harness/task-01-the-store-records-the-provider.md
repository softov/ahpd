---
title: The store records a session's provider
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/types/sessions.ts](../../../../packages/sdk/src/types/sessions.ts) - `SessionStore`"
  - "[code://packages/sdk/src/sessions.ts](../../../../packages/sdk/src/sessions.ts) - memory and file stores"
  - "[code://packages/sdk/src/host.ts#L6339-L6366](../../../../packages/sdk/src/host.ts#L6339-L6366) - where `setOwner` and `setConfig` are called for a new session"
---

## Objective

`SessionStore` gains `provider(id)` and `setProvider(id, provider)`, kept by the memory and file stores beside the owner and forgotten with the rest.
The host records it whenever a session starts running on an agent: created (`openSession`), resumed after a restart, forked, and started by an automation; against the host's id, and against the agent's own id (`agentId()`) once that names a different one.

## Files

- `UPDATE: packages/sdk/src/types/sessions.ts`, `packages/sdk/src/sessions.ts` - the field, stored and forgotten like `owner`; a file without it reads as nothing recorded.
- `UPDATE: packages/sdk/src/host.ts` - the calls.

## Validation

- `packages/sdk/test/sessions.test.ts`: the provider round-trips through the file store, an old file without it loads, `forget` removes it.
- A host test: a created, a resumed and a forked session each record their provider; a session whose agent names its own id records it under that id too.

## Resume
