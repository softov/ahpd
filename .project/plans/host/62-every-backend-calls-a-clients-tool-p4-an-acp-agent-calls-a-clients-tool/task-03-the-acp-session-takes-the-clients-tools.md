---
title: The ACP session takes the clients' tools and lets go of their calls
status: todo
depends: [task-02-the-mcp-request-is-paired-to-its-call.md]
layer: "agent-acp"
refs:
  - "[code://packages/agent-acp/src/session.ts#L186-L200](../../../../packages/agent-acp/src/session.ts#L186-L200) - the snapshot"
  - "[code://packages/agent-acp/src/session.ts#L231-L242](../../../../packages/agent-acp/src/session.ts#L231-L242) - `cancel`"
  - "[code://packages/agent-acp/src/session.ts#L266-L321](../../../../packages/agent-acp/src/session.ts#L266-L321) - the members and `close`"
  - "[code://packages/agent-acp/src/plugin.ts#L60-L90](../../../../packages/agent-acp/src/plugin.ts#L60-L90) - the plugin and per-agent options"
  - "[code://packages/agent-acp/src/types.ts](../../../../packages/agent-acp/src/types.ts) - the options type, beside `hostTools`"
  - "[code://packages/sdk/src/host/tooling.ts#L164-L170](../../../../packages/sdk/src/host/tooling.ts#L164-L170) - `retool` calls `setTools` on every chat"
---

## Objective

The ACP session answers `setTools`, `toolCallOwner`, `completeToolCall` and `clientGone`, lists its open client calls in its snapshot, releases them on cancel and close, and tells its agent of new tools as the `toolsChanged` option says.

## Files

- `UPDATE: packages/agent-acp/src/session.ts:186-321` - the four members from the holder and `setTools` replacing the endpoint's tools; `entries()` in `sessionState`; `calls.release` in `cancel` and `close`.
- `UPDATE: packages/agent-acp/src/plugin.ts`, `packages/agent-acp/src/types.ts` - `toolsChanged: "notify" | "list"`, plugin-wide and per agent like `hostTools`, default `notify`.
- `UPDATE: packages/agent-acp/src/session/opening.ts:155-172` - `toolsServer({ runClient, toolsChanged })`.
- `UPDATE: packages/agent-acp/test/agent-acp-client-tool.test.ts` - the cases below.

## Steps

1. Write the cases first and see them fail on the missing members.
2. `setTools` keeps the turn's owner lookup and the endpoint's list current; the endpoint, opened with the session's `toolsChanged`, sends `notifications/tools/list_changed` under `notify` and nothing under `list`.
3. Release with `The turn was stopped` and `The session was closed`.

## Validation

- `packages/agent-acp/test/agent-acp-client-tool.test.ts`, written first:
  - a client announced after the session opened: `tools/list` on the endpoint lists its tool, under both values.
  - `toolsChanged: "notify"`, and the option unset: the fake server's open `GET` stream receives `notifications/tools/list_changed` when the client announces.
  - `toolsChanged: "list"`: no notification is sent and `GET` answers 405.
  - a client that leaves: its tool is gone from `tools/list` and its open call fails.
  - `sessionState().inputNeeded` holds the open call's entry, and the status stays `InProgress`.
  - cancel and close fail an open call and the MCP request answers.
- `vitest run packages/agent-acp`, `pnpm typecheck` green.

## Resume
