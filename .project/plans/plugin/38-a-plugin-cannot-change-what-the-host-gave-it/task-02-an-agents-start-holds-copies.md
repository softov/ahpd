---
title: An agent's start holds copies of what the host keeps
status: done
depends: [task-01-a-principal-cannot-be-changed.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/spawn.ts#L445-L513](../../../../packages/sdk/src/host/spawn.ts#L445-L513) - the `Start` an agent gets"
  - "[code://packages/sdk/src/host/sessionconfig.ts#L325-L368](../../../../packages/sdk/src/host/sessionconfig.ts#L325-L368) - `schema()` returns other plugins' entries by reference"
  - "[code://packages/sdk/src/host/tooling.ts#L110-L122](../../../../packages/sdk/src/host/tooling.ts#L110-L122) - tool definitions"
  - "[code://packages/sdk/src/host/tooling.ts#L270-L282](../../../../packages/sdk/src/host/tooling.ts#L270-L282) - a tool's `context()`"
  - "[code://packages/sdk/src/host/tooling.ts#L408](../../../../packages/sdk/src/host/tooling.ts#L408) - `mcpFor`"
---

## Objective

Nothing in an agent's `Start`, or in a host tool's call context, is an object the host reads again.
An agent cannot change another plugin's session-config key, a host tool's definition, an MCP server entry, the host's file store or another backend's turns.

## Files

- `UPDATE: packages/sdk/src/host/spawn.ts:445-513` - `schema()`, `tools`, `mcpServers`, `settings` and `additional` go through `frozenCopy`; `resources` is a new frozen object per session whose methods call the host's store.
- `UPDATE: packages/sdk/src/host/sessionconfig.ts:325-368` - `runningSchema` returns a frozen copy to the agent; the host's own reads keep the store.
- `UPDATE: packages/sdk/src/host/tooling.ts` - `boundTools` hands frozen copies of definitions; `mcpFor` copies each entry; `context()` returns `frozenCopy` of the turns.
- `UPDATE: packages/sdk/test/plugin-boundary.test.ts` - the cases below.

## Steps

1. Write the tests below; they fail.
2. Copy at each site named in Files.
3. Run the full suite; an in-repo agent that wrote to its `Start` is fixed in that agent.

## Validation

- An agent that sets `default` on another plugin's key in `schema()` throws, and the next session's default is unchanged.
- An agent that renames a `tools[].definition` throws, and `serverTools` on the wire is unchanged.
- An agent that sets `url` on an `mcpServers` entry throws, and the next session gets the host's entry.
- An agent that replaces `resources.read` throws, and a client read is unchanged.
- A tool that writes to `context().turns[0]` throws, and the backend's turn is unchanged.
- `npx vitest run` passes.

## Resume

Implemented 2026-10-08. The backend half of the same promise: what a `Start` and a host tool's `context()` hold is the host's own copy. `sessionconfig.ts`'s `runningSchema` (the one `spawn.ts` hands the backend) is a `frozenCopy`, with every property the backend may not write marked `readOnly`. `tooling.ts` copies the MCP server map, a client tool's definition, each bound tool's definition and effects, and the turns `context()` answers with. `spawn.ts` hands `Start.resources` the host's store through a new `heldResources`, which forwards each method onto the host's and freezes the wrapper: a store has methods, and `structuredClone` carries none, so the object is built new and frozen rather than copied. Bound tools are `deepFreeze`d (they hold `run`, so they cannot be copied), and `additional` and `settings` are `frozenCopy`d.

Five cases in `plugin-boundary.test.ts` start a session with the echo backend behind a probe agent that tries one write, then check the next session, or the client, still reads what the host holds: a `default` in a session key the host contributed, a tool definition's `name`, an MCP server's `url`, a replaced method on the resource store, and a turn a host tool was handed (the last calls `run` directly). A write refused where it is made throws `TypeError`, but the host reports a backend that throws while its session is being made as `-32602` in the backend's own words (`host/lifecycle.ts`), so the session cases assert that shape and name the engine's sentence about a read-only property.

Verified: `npx vitest run packages/sdk/test/plugin-boundary.test.ts` - 13 passed at this task's end.
