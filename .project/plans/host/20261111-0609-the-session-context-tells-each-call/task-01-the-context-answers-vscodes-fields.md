---
title: The context answers VS Code's fields
status: implemented
depends: []
layer: "sdk, docs"
refs:
  - "[code://packages/sdk/src/tools/session.ts#L242-L295](../../../../packages/sdk/src/tools/session.ts#L242-L295) - `serializeContext`, which gets the four fields"
  - "[code://packages/sdk/src/tools/session.ts#L990-L1027](../../../../packages/sdk/src/tools/session.ts#L990-L1027) - `get_session_context`, which gets `responseTurnId` and `responseOffset`"
  - "[code://packages/sdk/src/tools/session.ts#L296-L324](../../../../packages/sdk/src/tools/session.ts#L296-L324) - `delegated`, whose meta names a message's sender and revision"
  - "[code://packages/sdk/src/types/host.ts#L1692](../../../../packages/sdk/src/types/host.ts#L1692) - `context`, which gets the chat's pending messages"
  - https://github.com/microsoft/vscode/blob/a1a15017f8a/src/vs/platform/agentHost/node/shared/sessionServerTools.ts#L1876-L2001 - the fields, the page and the refusals this task copies
---

## Objective

`get_session_context` answers `assistantTruncated` and `responseTurnId` for a cut reply, and reads one reply whole in pages.
It answers `messagesSentByMe` for the calling chat, and `harness` for a chat that runs another agent.

## Files

- `UPDATE: packages/sdk/src/types/host.ts:1692` - `context` also answers the chat's pending messages, each with its id, its kind and its message.
- `UPDATE: packages/sdk/src/host/tooling.ts` - that answer, from the chat's queue and steering.
- `UPDATE: packages/sdk/src/tools/session.ts:242-295` - `serializeContext` adds `assistantTruncated`, `responseTurnId`, `messagesSentByMe` and `harness`.
- `UPDATE: packages/sdk/src/tools/session.ts:990-1027` - `get_session_context` takes `responseTurnId` and `responseOffset`, and answers one page of a turn's reply.
- `UPDATE: packages/sdk/test/sessiontools.test.ts` - the cases in *Validation*.
- `UPDATE: docs/sdk/TOOLS.md` - the four fields and the page of a reply.
- `UPDATE: UPSTREAM.md:25` - note that `get_session_context` returns the caller's pending messages, with this plan's id.

## Steps

1. Add the pending messages to the answer of `context`, from the chat's queue and steering.
2. Mark a turn `assistantTruncated` when its whole reply is longer than the level's cap.
3. Give that turn's id as `responseTurnId`.
4. List `messagesSentByMe` for a caller with a chat, from the messages whose `delegated` meta names that chat.
5. Give each one `messageId`, `revision`, `delivery`, `status` and `message`, as VS Code does.
6. Leave `messagesSentByMe` out for a caller with no session.
7. Add `harness` where the host records another agent for the chat.
8. Take `responseTurnId` and `responseOffset` in the input, with VS Code's schema and checks.
9. Answer one page of 8000 characters, with `responseLength`, `nextResponseOffset` and `truncated`.
10. Refuse an unknown `responseTurnId` and an offset past the reply, in VS Code's words.
11. Use VS Code's description for the tool and its new fields.
12. Update the docs and `UPSTREAM.md`.
13. Write the tests.

## Validation

- `packages/sdk/test/sessiontools.test.ts`: a reply longer than the `summary` cap carries `assistantTruncated` and its `responseTurnId`.
- Its pages, read with `nextResponseOffset` until `truncated` is false, add up to the whole reply.
- The tool refuses an unknown `responseTurnId` and an offset past the end.
- A queued message the calling chat sent shows in `messagesSentByMe` with its revision.
- A message another chat sent does not show.
- A caller with no session gets no `messagesSentByMe`.
- `pnpm typecheck` passes.
- `TMPDIR=/home/softov/tmp/ahpd-test npx vitest run packages/sdk` passes.

## Resume

Implemented 2026-11-11. `get_session_context` answers `assistantTruncated` and `responseTurnId` for a reply longer than its level's cap. It takes `responseTurnId` with `responseOffset` to read one completed turn's reply in pages of 8000 characters, with `responseLength`, `nextResponseOffset` and `truncated`. It refuses an unknown turn and an offset past the reply in VS Code's own sentences. `messagesSentByMe` lists the calling chat's own pending messages from the host's new `pendingMessages`. Each one carries `messageId`, `revision`, `delivery`, `status` and `message`, and a caller with no session gets none. `harness` names a chat's agent where the host records another than its session's, through `harnessOf`, which reads the row's `chats` by `idOf`. `packages/sdk/src/types/host.ts` and `packages/sdk/src/host/tooling.ts` carry the pending messages, which are beyond this task's Files. Tests are in `packages/sdk/test/sessiontools.test.ts`. Gate: `pnpm exec tsc -p tsconfig.json --noEmit` is clean and `pnpm -s schema` generated 508 definitions. The vitest suites did not run: the mandated `flock` prefix is denied by this session's permission mode.

