---
title: A chat request names its origin, interactivity and tools
status: implemented
depends: []
layer: "sdk host"
refs:
  - "[code://packages/sdk/src/types/plugin.ts#L168-L204](../../../../packages/sdk/src/types/plugin.ts#L168-L204) - `ChatRequest`, which gets the three fields"
  - "[code://packages/sdk/src/plugins/validate.ts#L614-L650](../../../../packages/sdk/src/plugins/validate.ts#L614-L650) - the check of a `startChat` request"
  - "[code://packages/sdk/src/host/tooling.ts#L1917-L1995](../../../../packages/sdk/src/host/tooling.ts#L1917-L1995) - `openChat`, which applies them"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L1705-L1712](../../../../packages/sdk/src/host/sessionmethods.ts#L1705-L1712) - the `madeFrom` write to copy"
  - "[code://packages/sdk/src/host/catalogue.ts#L244-L268](../../../../packages/sdk/src/host/catalogue.ts#L244-L268) - `chatSummary`, which writes `full` today"
  - "[code://packages/sdk/src/host/spawn.ts#L1280-L1289](../../../../packages/sdk/src/host/spawn.ts#L1280-L1289) - `boundTools`, where the chat's tools join"
---

## Objective

`startChat` takes `origin`, `interactivity` and `tools`, and the chat opens with them, in its summary, its state, its record and its tool list.

## Files

- `UPDATE: packages/sdk/src/types/plugin.ts:168-204` - add `origin`, `interactivity` and `tools` to `ChatRequest`, each with its doc comment.
- `UPDATE: packages/sdk/src/plugins/validate.ts:614-650` - check the three fields and answer them in the host's shape.
- `UPDATE: packages/sdk/src/host/tooling.ts:1917-1995` - write the origin to `madeFrom`, the interactivity to the chat, and the tools to the chat's tool list before `spawn`.
- `UPDATE: packages/sdk/src/host/catalogue.ts:244-268` - answer the chat's own interactivity, not `full`.
- `UPDATE: packages/sdk/src/host/spawn.ts:1280-1289` - add the chat's own tools to what `boundTools` answers for it.
- `UPDATE: packages/sdk/src/host/chatrecord.ts` - keep the interactivity and the tools in the chat record, and read them back at load.
- `UPDATE: packages/sdk/test` - the cases in *Validation*.

## Steps

1. Add `origin?: ChatOrigin`, `interactivity?: 'full' | 'read-only' | 'hidden'` and `tools?: string[]` to `ChatRequest`.
2. In `validate.ts`, refuse an origin whose kind is not `user` or `tool`, with the sentence style of the other fields.
3. In `validate.ts`, refuse an interactivity outside the three protocol values.
4. In `validate.ts`, refuse a tool name the plugin did not register, with the check a session request's `tools` get.
5. In `openChat`, refuse a `tool` origin whose chat is not in the same session.
6. In `openChat`, write the origin to `madeFrom` before `spawn`, as `sessionmethods.ts:1712` does.
7. In `openChat`, open the chat's state with the interactivity the request names, else `full`.
8. Keep the chat's tools so `boundTools(session, chat, provider)` adds them for that chat only.
9. Write the interactivity and the tools to the chat record, and read them back in `chatrecord.ts`.
10. Make `chatSummary` answer the chat's own interactivity.

## Validation

- A test starts a plugin chat with a `tool` origin, `read-only` and `post_message`, and reads all three in `session/chatAdded`.
- A test starts a chat with none of the fields, and reads `user`, `full` and the session's tools.
- A test restarts the host, and the chat has the same origin, interactivity and tools.
- A test asks for a `tool` origin in another session, and the host refuses the start.
- `pnpm typecheck` passes, and `pnpm vitest run packages/sdk` passes.

## Resume

- Built on 2026-11-13, with five cases in `packages/sdk/test/plugin-chat-shape.test.ts`.
- The host keeps the interactivity and the tools in two maps beside `madeFrom`, `chatInteractivity` and `chatTools`, and in the chat row.
- The check that a tool is the plugin's own is in the plugin's `startChat` in `plugins.ts`, where the plugin's tool names are.
- The restart case reads the chat row back. It does not start a second host.
- A worker of a chat that is not the lead sent its approvals to the lead's backend. So a bot Back's subagent waited for ever (Softov's Ember timer, 2026-11-13). `workerLead` in `spawn.ts` now finds the backend of the chat whose call started the worker. Two cases in `subagent-chat.test.ts`, and the test daemon ran the subagent's `Bash`.

