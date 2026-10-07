---
title: The ACP session takes the clients' tools and lets go of their calls
status: done
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

The ACP session answers `setTools`, `toolCallOwner`, `completeToolCall` and `clientGone`.
It lists its open client calls in its snapshot.
It releases them on cancel and close.
It tells its agent of new tools as the `toolsChanged` option says.

## Files

- `UPDATE: packages/agent-acp/src/session.ts:186-321` - the four members from the holder; `entries()` in `sessionState`; `calls.release` in `cancel` and `close`.
- `UPDATE: packages/agent-acp/src/session/clientcalls.ts` - `setTools` extended to keep the endpoint's list current, not only the turn's owner lookup; the rest of the area is task 01's.
- `UPDATE: packages/agent-acp/src/plugin.ts`, `packages/agent-acp/src/types.ts` - `toolsChanged: "notify" | "list"`, plugin-wide and per agent like `hostTools`, default `notify`.
- `UPDATE: packages/agent-acp/src/session/opening.ts:155-172` - `toolsServer({ runClient, toolsChanged })`.
- `UPDATE: packages/agent-acp/test/agent-acp-client-tool.test.ts` - the cases below.

## Steps

1. Write the cases first and see them fail on the missing members.
2. Keep the turn's owner lookup and the endpoint's list current in `setTools`.
   Open the endpoint with the session's `toolsChanged`.
   Under `notify` it sends `notifications/tools/list_changed`, and under `list` it sends nothing.
3. Release with `The turn was stopped` and `The session was closed`.

## Validation

- `packages/agent-acp/test/agent-acp-client-tool.test.ts`, written first:
  - Announce a client after the session opened, and check `tools/list` on the endpoint lists its tool, under both values.
  - Set `toolsChanged: "notify"`, and leave the option unset.
  - Check the fake server's open `GET` stream receives `notifications/tools/list_changed` when the client announces.
  - Under `toolsChanged: "list"`, check no notification goes out and `GET` answers 405.
  - Take a client away, and check its tool is gone from `tools/list` and its open call fails.
  - Check `sessionState().inputNeeded` holds the open call's entry, and the status stays `InProgress`.
  - Cancel and close an open call, and check the MCP request answers.
- `vitest run packages/agent-acp`, `pnpm typecheck` green.

## Resume

- **Done:** `packages/agent-acp/src/session/opening.ts` hands `start.toolsServer` the runner and `options.toolsChanged ?? 'notify'`.
  It answers `toolsEndpoint()`, the endpoint it keeps.
  The endpoint is asked rather than handed out, because it is opened inside the first `session/new`.
  `packages/agent-acp/src/session/clientcalls.ts`'s `setTools` writes the offering and the endpoint's list in one move.
  So a client that arrives is a tool that can be recognised and a tool the agent can call, or neither.
  `packages/agent-acp/src/session.ts` lists `ctx.calls.entries()` as the snapshot's `inputNeeded` while there are any, and releases the calls with `The turn was stopped` in `cancel` and `The session was closed` in `close`.
  `packages/agent-acp/src/types.ts` gains `toolsChanged` and `packages/agent-acp/src/plugin.ts` resolves it per preset over the plugin-wide setting, both levels in the options schema.
  Nine more cases are in `packages/agent-acp/test/agent-acp-client-tool.test.ts`, which had nine.
- **Failed first:** the nine cases were written before any of it, and run against the tree as it stood.
  Nine of nine failed.
  Four failed on a five-second timeout.
  The two `notify` cases failed on the `405` the endpoint answers when it is opened with the tool server's own default.
  The snapshot case failed on no `inputNeeded` at all.
  The close case failed on no answer written for the request.
  The `list` case failed on a list that never gained the tool.
- **The listener had to flush its head, and stream its body.**
  The endpoint's `GET` is open until the session goes, so reading the response whole waited for the end of the test.
  Streaming it was not enough on its own.
  `writeHead` leaves the head in node's buffer until the first byte of the body.
  So a client that waited for the head before the change that would produce a byte was waiting for itself.
  The listener flushes the head and then writes each chunk as it comes.
- **The option's own line in the README belongs here:** `agent-acp-options.test.ts` holds the options schema to the README's table.
  So adding `toolsChanged` to the schema reddens the suite until the table lists it.
  The rows are written here, plugin-wide and per preset.
  [task 04](task-04-readme-and-by-hand.md) keeps the prose about client tools and the by-hand run, which is what it was for.
- **Where an answer is read from, and why not the chat:** a disposed session has no channel left to report on.
  So the last case reads the answer at the socket the agent's request came back on.
  The test's own listener keeps the bodies it forwards.
  That is also the only place that answer exists once the session is gone.
- **Verification:** `npx vitest run packages/agent-acp/test/agent-acp-client-tool.test.ts` is green, 18 cases, three runs stable.
  `npx tsc -b` is green.
  `pnpm boundary` is green (`@ahpd/agent-acp: 2 declared, none undeclared`).
  `npx vitest run packages/agent-acp` is green once at 201 passed and once at 200 passed, with the one failure task 01 recorded.
  That failure is `agent-acp-machine.test.ts > reaches a disposable machine`.
  It passes on its own, and tips past the default five seconds under the whole suite's load.
- **Next action:** [task-04-readme-and-by-hand.md](task-04-readme-and-by-hand.md).
