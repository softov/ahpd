---
title: An ACP part is the protocol's
status: todo
depends: []
layer: "agent-acp"
refs:
  - "[code://packages/agent-acp/src/mapping.ts](../../../../packages/agent-acp/src/mapping.ts) - the parts of a turn and their lookup"
  - "[code://packages/agent-acp/test/agent-acp-ports.test.ts](../../../../packages/agent-acp/test/agent-acp-ports.test.ts) - the cases through the host"
---

## Objective

Every part of an ACP session is the protocol's part, and the server's commands sit in a directory.
The snapshot holds the calls a client that watched the actions built.

## Files

- `UPDATE: packages/agent-acp/src/mapping.ts:32-33` - `callPartOf` finds a tool call part by the call's own id, for the session too.
- `UPDATE: packages/agent-acp/src/mapping.ts:96-135` - `callOf` makes a tool call part with no `id`.
- `UPDATE: packages/agent-acp/src/mapping.ts:184-196` - `ready` puts its fields onto the held call.
- `UPDATE: packages/agent-acp/src/mapping.ts:284-322` - `closed` and `shown` put their fields onto the held call, as the reducer does.
- `UPDATE: packages/agent-acp/src/session/handlers.ts:104-112` - `commandsIn` holds the commands in one directory.
- `UPDATE: packages/agent-acp/src/session/handlers.ts:546-566` - a permission finds and makes its call part by the call's id.
- `UPDATE: packages/agent-acp/src/session/handlers.ts:878` - a confirmation finds its call part by the call's id.
- `UPDATE: packages/agent-acp/src/session/queue.ts:70` - the part of a shell command has no `id`.
- `UPDATE: packages/agent-acp/test/agent-acp-ports.test.ts` - the case through the host.

## Steps

1. Replace `partOf` with an exported `callPartOf` that reads the call's `toolCallId`.
2. Remove `id` from the three literals that make a tool call part.
3. Use `callPartOf` in the two lookups of `handlers.ts`.
4. In `ready`, build the fields once, put them onto the held call with status `running`, and send them.
5. In `closed`, build the result once, drop the held content, and put the result onto the held call.
6. In `shown`, put the content onto a held call that runs.
7. Hold the commands in one directory customization with `contents: prompt` and `writable: false`.
8. Add the case: a reported call, a call asked about first and a shell command.

## Validation

- Test in `packages/agent-acp/test/agent-acp-ports.test.ts` that the protocol declares every frame, and that the late calls equal the replayed calls.
- Run the case on the session before this change, and see it fail.
- The agent-acp suite passes.

## Resume

