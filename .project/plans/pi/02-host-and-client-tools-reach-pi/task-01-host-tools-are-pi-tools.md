---
title: Host tools are pi tools
status: implemented
depends: []
layer: "agent-pi"
refs:
  - "[code://packages/agent-claude/src/session.ts#L484-L540](../../../../packages/agent-claude/src/session.ts#L484-L540) - the conversion to copy, including the error-as-answer handling"
  - "[code://packages/agent-pi/src/backend.ts#L65-L96](../../../../packages/agent-pi/src/backend.ts#L65-L96) - `BackendOptions` and `openPi`"
  - "[code://packages/agent-pi/src/session.ts#L238-L274](../../../../packages/agent-pi/src/session.ts#L238-L274) - `opened`, which builds the backend options"
---

## Objective

Every `Start.tools` entry with a `run` is offered to pi's model as a custom tool, and a call to it answers with what `run()` returned.

## Files

- `CREATE: packages/agent-pi/src/tools.ts` - `toPiTool(bound, client)`: one `BoundTool` as a pi `ToolDefinition`; `client` is how a client-owned call waits, filled in by task 02.
- `UPDATE: packages/agent-pi/src/backend.ts:65-96` - `BackendOptions.tools?: ToolDefinition[]`, passed as `customTools` to `createAgentSessionFromServices`.
- `UPDATE: packages/agent-pi/src/session.ts` - `let offering: BoundTool[] = [...(start.tools ?? [])]`; `opened` converts and passes them.
- `UPDATE: packages/agent-pi/src/index.ts` - export `toPiTool` beside the other helpers.
- `UPDATE: test/agent-pi.test.ts` - the cases below.

## Steps

1. In `tools.ts`, build `defineTool({ name, label, description, parameters, execute })`: `name` is `definition.name`; `label` is `definition.title ?? definition.name`; `description` falls back the way the sibling's does; `parameters` is `Type.Unsafe(definition.inputSchema ?? { type: 'object' })` with `Type` imported from `@earendil-works/pi-ai`.
2. `execute(toolCallId, params)` for a host tool awaits `bound.run(params)` and returns `{ content: [{ type: 'text', text }], details: undefined }`. A thrown error is rethrown as an `Error` with the same message, which pi reports as a failed call; check that against pi's own tools before choosing throw over an error result.
3. Drop a tool whose name is one of pi's built-in tool names, and say so in the log, rather than shadowing pi's own.
4. Pass the converted list from `opened` into `open(...)`.

## Validation

- `test/agent-pi.test.ts`: `toPiTool` keeps the name, title and schema; `execute` returns `run`'s text; a `run` that throws makes `execute` reject with the message.
- A session started with one host tool hands the fake's `open` a `tools` list naming it.
- `pnpm test`, `pnpm typecheck`, `pnpm boundary` green; `pnpm boundary` confirms nothing new is imported past `@ahpd/sdk` and pi's own packages.

## Resume

Built.
`src/tools.ts` is new: `toPiTool(bound, client)` builds a pi `defineTool` from a `BoundTool`, keeps `definition.name`, `title` and `inputSchema` through `Type.Unsafe`, and returns nothing with a warning for a name pi already owns.
A host tool's `execute` answers `run`'s text as a text result, and a `run` that throws rejects the call with the same message.
`BackendOptions.tools` is passed as `customTools` to `createAgentSessionFromServices`, and `session.ts` keeps `offering` from `Start.tools` and converts it in `opened`.
The client-owned branch calls the `client` callback, which task 02 fills with the real wait; until then a call to a client tool fails and says so.

- `test/agent-pi.test.ts` covers the conversion, `run`'s answer, a throwing `run`, a dropped built-in name, and a session handing pi its custom tools.
- `pnpm test` 102 files, 1356 tests; `pnpm typecheck` and `pnpm boundary` green.
