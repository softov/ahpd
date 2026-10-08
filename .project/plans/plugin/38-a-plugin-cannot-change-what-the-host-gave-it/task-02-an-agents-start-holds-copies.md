---
title: An agent's start holds copies of what the host keeps
status: todo
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
