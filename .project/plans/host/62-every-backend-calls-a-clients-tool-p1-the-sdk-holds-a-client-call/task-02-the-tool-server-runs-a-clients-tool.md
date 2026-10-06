---
title: The tool server runs a client's tool and serves the tools the session has now
status: todo
depends: [task-01-a-client-call-is-held-in-one-place.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/toolserver.ts#L102-L128](../../../../packages/sdk/src/toolserver.ts#L102-L128) - `answered`: line 111 refuses a tool with no `run`"
  - "[code://packages/sdk/src/toolserver.ts#L151-L168](../../../../packages/sdk/src/toolserver.ts#L151-L168) - `open` stores the tools once per endpoint"
  - "[code://packages/sdk/src/host/spawn.ts#L364-L379](../../../../packages/sdk/src/host/spawn.ts#L364-L379) - `toolsServer` opens on `boundTools` at the moment the backend asks"
  - "[code://packages/sdk/src/types/agent.ts#L196-L216](../../../../packages/sdk/src/types/agent.ts#L196-L216) - `Start.toolsServer`"
  - "https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/claude/clientTools/claudeClientToolResult.ts#L35-L83 - the protocol-to-MCP content conversion to mirror"
  - "https://modelcontextprotocol.io/specification/2025-06-18/server/tools#list-changed-notification - `listChanged` in the capability, and `notifications/tools/list_changed`"
  - "https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#listening-for-messages-from-the-server - a `GET` opens the server-to-client stream"
  - "[code://packages/sdk/test/toolserver.test.ts](../../../../packages/sdk/test/toolserver.test.ts) - the cases to extend"
---

## Objective

A backend that asks for the tool server can hand it a runner for client tools, and a `tools/call` for a client's tool goes to that runner with the MCP request's `_meta` and answers with MCP content; the endpoint's tool list can be replaced while the session runs, and with `toolsChanged: 'notify'` the server tells a listening agent so.

## Files

- `UPDATE: packages/sdk/src/toolserver.ts:102-207` - `answered` calls `runClient(tool, input, meta)` for a tool with an `owner`; `ToolsEndpoint.setTools(tools)` replaces what the path serves; with `toolsChanged: 'notify'` the server declares `tools: { listChanged: true }`, a `GET` opens an event stream instead of 405, and `setTools` sends `notifications/tools/list_changed` on every open stream.
- `CREATE: packages/sdk/src/mcpcontent.ts` - `toMcpContent(answer, callId)`: text as text, an `image/*` embedded resource as an image, another embedded resource as a resource blob under a minted URI, anything else as its JSON in a text block, as VS Code converts it.
- `UPDATE: packages/sdk/src/types/agent.ts:196-216` - `toolsServer({ runClient?, toolsChanged? })`, with `RunClientTool` typed as `(tool: BoundTool, input: Record<string, unknown>, meta: Record<string, unknown> | undefined) => Promise<ClientCallAnswer>` and `toolsChanged: 'notify' | 'list'`.
- `UPDATE: packages/sdk/src/host/spawn.ts:364-379` - pass the runner through to `open`.
- `UPDATE: packages/sdk/test/toolserver.test.ts` - the cases below.

## Steps

1. Write the cases first and see them fail on today's refusal.
2. `open(tools, runClient?)` keeps the runner beside the tools; `setTools` swaps the tools under the same path and token.
3. In `answered`, a tool with `owner` and a runner returns `toMcpContent` of the runner's answer with `isError` when `ok` is false; with no runner it keeps today's refusal, so a backend that never asked is unchanged.
4. `params._meta` of the `tools/call` is handed to the runner as it came, so a backend can read a call id an agent put there.
5. `toolsChanged: 'notify'`: the capability, the `GET` stream under the same token, and the notification on `setTools`; `'list'`: no capability flag, `GET` refused as today, and the next `tools/list` answers the new set. Both always serve the current list.

## Validation

- `packages/sdk/test/toolserver.test.ts`, written first:
  - a client's tool with a runner: `tools/call` answers the runner's text, and `_meta` from the request reaches the runner.
  - an answer with a PNG embedded resource comes back as an MCP `image` block, a PDF one as a `resource` blob, and both beside the text.
  - the runner answering `ok: false`: the result has `isError: true` and the text.
  - no runner: the refusal is unchanged.
  - `setTools` with a new client tool: `tools/list` lists it and `tools/call` reaches it; a tool removed is answered as unknown.
  - `toolsChanged: 'notify'`: `initialize` declares `listChanged: true`, an open `GET` stream receives `notifications/tools/list_changed` after `setTools`, and a `GET` with the wrong token is refused.
  - `toolsChanged: 'list'`: no `listChanged`, `GET` answers 405, and the next `tools/list` has the new tool.
- `pnpm typecheck` green.

## Resume
