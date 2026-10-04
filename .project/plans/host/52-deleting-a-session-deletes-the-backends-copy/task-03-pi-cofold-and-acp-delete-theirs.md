---
title: pi, cofold and ACP delete their own copy
status: todo
depends: [task-01-the-host-deletes-through-the-agent.md]
layer: "agents"
refs:
  - "[code://packages/agent-pi/src/catalog.ts#L54](../../../../packages/agent-pi/src/catalog.ts#L54) - `stateFile`, the one file pi writes per session"
  - "[code://packages/agent-cofold/src/agent.ts#L625](../../../../packages/agent-cofold/src/agent.ts#L625) - `list` over `store.sessions`"
  - "[code://packages/agent-acp/src/agent.ts#L94](../../../../packages/agent-acp/src/agent.ts#L94) - `list`, the server's `session/list`"
  - npm://@cofold/store-file@0.1.1 - `store.sessions.delete({ sessionId })`
  - npm://@agentclientprotocol/sdk@^1.5.0 - `session/delete` and `sessionCapabilities.delete`
---

## Objective

Each other agent that lists sessions deletes one: pi removes its file, cofold deletes it from its store, ACP sends `session/delete` when the server offers it.

## Files

- `UPDATE: packages/agent-pi/src/agent.ts`, `catalog.ts` - `delete` removes the path `stateFile` answers; no path is done.
- `UPDATE: packages/agent-cofold/src/agent.ts` - `delete` calls `store.sessions.delete({ sessionId })`.
- `UPDATE: packages/agent-acp/src/agent.ts`, `catalog.ts` - `delete` sends `session/delete` on the listing connection when its `initialize` answer has `sessionCapabilities.delete`, and is absent otherwise.
- `UPDATE:` each package's tests.

## Steps

1. pi: `rm` the file with `force`, refusing a path outside pi's session directory.
2. cofold: the store call; a running cofold run refuses a delete, so this runs after the host's teardown (task 01).
3. ACP: read the capability from the listing connection's handshake; drop the session's entries from `watched` and `placeOf` after the delete.

## Validation

- pi: a written session file is removed; a path outside the session directory is refused.
- cofold: a stored session is gone from `list` after `delete`.
- ACP: against the test server, `session/delete` is sent with the advertised capability and not without it.

## Resume

