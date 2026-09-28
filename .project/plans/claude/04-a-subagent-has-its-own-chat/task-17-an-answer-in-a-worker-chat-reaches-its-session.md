---
title: An answer given in a worker chat reaches its session, and a stop there stops the lead turn
status: done
depends: [task-05-asks-inside-a-subagent.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L8256-L8257](../../../../packages/sdk/src/host.ts#L8256-L8257) - the dispatch lookup, which knows lead chats and sessions and no worker chat"
  - "[code://packages/sdk/src/host.ts#L8292-L8295](../../../../packages/sdk/src/host.ts#L8292-L8295) - the read-only refusal of `chat/turnStarted` on a worker chat"
  - "[code://packages/sdk/src/host.ts#L8402](../../../../packages/sdk/src/host.ts#L8402) - \"names nothing here\", the refusal Softov saw"
  - "[code://packages/sdk/src/host.ts#L3021](../../../../packages/sdk/src/host.ts#L3021) - `openSubagent` keeps a worker chat in `subagents` only"
  - "[code://packages/agent-claude/src/session.ts#L1807](../../../../packages/agent-claude/src/session.ts#L1807) - an ask inside a worker names the worker chat as where it is answered"
  - "[code://packages/sdk/test/subagent-chat.test.ts](../../../../packages/sdk/test/subagent-chat.test.ts) - the fake backend that opens a worker chat"
---

## Objective

A client that answers a permission or a question on the worker chat the request names reaches the session's backend, and a client that stops the turn from a worker chat stops the lead turn that owns it.

## Files

- `UPDATE: packages/sdk/src/host.ts:8256-8295` - a worker chat, in the held spelling or a client's alias, resolves to its session's lead backend for `chat/toolCallConfirmed`, `chat/inputCompleted` and `chat/turnCancelled`; any other action on a worker chat is refused as read-only, as `chat/turnStarted` is.
- `UPDATE: packages/sdk/src/host.ts` (`spelledFor`) - `inputNeeded[].chat` is respelled for a client like the other worker chat URIs, if the case below shows it is not.
- `UPDATE: packages/sdk/test/subagent-chat.test.ts` - the cases below.

## Steps

1. Resolve a worker chat channel to its session with `sessionFor` and the lead with `leadOf`.
2. Admit the three actions above and refuse the rest with the read-only sentence.

## Validation

- Reproduced on 2026-09-28 at the SDK level: a fake backend asks inside a worker with `session/inputNeededSet` naming the worker chat, the client answers `chat/toolCallConfirmed` on that chat, the backend's `confirm` is never called and the wire carries "chat/toolCallConfirmed names nothing here (toolCallId, approved, confirmed)".
- A case: that answer reaches the backend's `confirm` with the call's id, under the held spelling and under an alias; it fails first.
- A case: `chat/inputCompleted` on a worker chat reaches the backend.
- A case: `chat/turnCancelled` on a worker chat cancels the lead turn.
- A case: `chat/draftChanged` on a worker chat is refused as read-only.
- By hand, for Softov: approve a permission asked inside a subagent in ahpapp or VS Code.
- `pnpm typecheck`, `pnpm boundary`, `pnpm test` green.

## Resume

`packages/sdk/src/host.ts` refuses every action on a worker chat except `chat/toolCallConfirmed`, `chat/inputCompleted` and `chat/turnCancelled` (`WORKER_ACTIONS`), and resolves those three to the lead chat of the session `sessionFor` reads out of the worker URI.
`chat/turnCancelled` on a worker chat cancels the lead chat's active turn, and is refused with "Nothing is running on <lead> to stop" when the lead has no turn open.
`chatOf` names a running session's worker chat in the held spelling, as it already did the default chat, so a client that subscribed under an alias can subscribe to and dispatch on the worker chat it was given; a session that is not running keeps the client's spelling, as its default chat does.
`spelledFor` respells `inputNeeded[].chat`, because the alias case showed the snapshot handed an alias client the held spelling.
Five cases in `packages/sdk/test/subagent-chat.test.ts`, on a fake whose worker asks for a permission and a question, all failed first: an approval on the worker chat reaches `confirm` (held spelling), a denial reaches it under the `fake:/ask` alias with `inputNeeded` spelt the same way, `chat/inputCompleted` reaches `answer`, `chat/turnCancelled` cancels lead turn `t1`, and `chat/draftChanged` is refused as read-only.
The by-hand check in ahpapp or VS Code is left for Softov.
Gates: `pnpm typecheck` and `pnpm boundary` clean, `pnpm test` 107 files and 1515 tests passed.
