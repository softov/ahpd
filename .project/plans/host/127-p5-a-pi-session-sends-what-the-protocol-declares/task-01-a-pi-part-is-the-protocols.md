---
title: A pi part is the protocol's
status: done
depends: []
layer: "agent-pi"
refs:
  - "[code://packages/agent-pi/src/mapping.ts](../../../../packages/agent-pi/src/mapping.ts) - the parts of a turn and their lookup"
  - "[code://packages/agent-pi/test/agent-pi-declared.test.ts](../../../../packages/agent-pi/test/agent-pi-declared.test.ts) - the case through the host"
---

## Objective

Every part of a pi session is the protocol's part.
The snapshot holds the calls a client that watched the actions built.

## Files

- `UPDATE: packages/agent-pi/src/mapping.ts:31-34` - `partOf` finds a prose part, and an exported `callPartOf` finds a tool call part.
- `UPDATE: packages/agent-pi/src/mapping.ts:95-108` - a call's part has no `id`.
- `UPDATE: packages/agent-pi/src/mapping.ts:414-470` - a call's end puts its ready and its result onto the held call.
- `UPDATE: packages/agent-pi/src/session.ts:343` - a released question finds its call part by the call's id.
- `UPDATE: packages/agent-pi/src/session.ts:533` - a question finds its call part by the call's id.
- `UPDATE: packages/agent-pi/src/session.ts:1115-1165` - a shell command's part has no `id`, and keeps its ready and its result.
- `UPDATE: packages/agent-pi/src/session.ts:1360` - a decision finds its call part by the call's id.
- `UPDATE: packages/agent-pi/src/replay.ts:171` - a replayed call finds its part by the call's id.
- `CREATE: packages/agent-pi/test/agent-pi-declared.test.ts` - the case through the host.

## Steps

1. Split the lookup: `partOf` for a prose part, `callPartOf` for a tool call part.
2. Remove `id` from the two literals that make a tool call part.
3. Use `callPartOf` in the four lookups of `session.ts` and `replay.ts`.
4. At a call's end, build the ready and the result once, and put them onto the held call.
5. In the shell command, build the ready and the result once, and put them onto the held call.
6. Add the case: a call pi ran and a shell command, with the frames and the late calls checked.

## Validation

- Test in `packages/agent-pi/test/agent-pi-declared.test.ts` that the protocol declares every frame, and that the late calls equal the replayed calls.
- Run the case on the session before this change, and see it fail.
- The agent-pi suite passes.

## Resume

Done 2026-10-27.
The tool call parts have no `id`, and the four lookups read the call's `toolCallId`.
A call's end and a shell command put their ready and their result onto the held call.
The case fails before this change, and passes after it.

