---
title: A session asks what its chats ask
status: done
depends: []
layer: host
refs:
  - "[code://packages/sdk/src/host.ts#L1067-L1072](../../../../packages/sdk/src/host.ts#L1067-L1072) - what a chat's action moves on its session"
  - "[code://packages/sdk/src/host/catalogue.ts#L1495-L1520](../../../../packages/sdk/src/host/catalogue.ts#L1495-L1520) - `answerMirrored`, the entry a question's answers move"
---

## Objective

After each chat action the host says, the session's entries for that chat that no longer stand are taken down.
An entry stands while the chat's running turn holds open the question or the call it names.
A chat's entries go with its turn.

## Files

- `UPDATE: packages/sdk/src/host/catalogue.ts:1495-1520` - `askedLeft`, beside `answerMirrored`.
- `UPDATE: packages/sdk/src/host.ts:1067-1072` - `askedLeft` after each chat action.
- `CREATE: packages/sdk/test/host-input-needed.test.ts` - an entry past its turn, one past its question's response, and one that stands.
- `UPDATE: packages/agent-acp/test/agent-acp-client-tool.test.ts` - the rows of a turn that ended go with it.

## Steps

1. Read which entries of a chat its running turn still holds open, by the question's id or the call's.
2. Keep the entry of a call that is still streaming.
3. Remove each entry of the chat that no longer stands, after each of the chat's actions.
4. Add the cases, and change the ACP case that held its rows past the turn.

## Validation

- `packages/sdk/test/host-input-needed.test.ts`: the two removals fail on `89ebe4d5` and pass after; the control passes on both.
- The sdk and backend test files pass.
- `pnpm run typecheck` is clean.

## Resume

Built 2026-11-02.

- A first build derived every entry from the chat's call, as the reference host does, and stopped a backend's own entries.
- It failed client tools: the chat names a client's call by the model's name, `mcp__ahp__<client>__<tool>`.
- VS Code's chat runs a client's call by the entry's `toolCall.toolName`, so the derived entry named no tool of the client's.
- So the host takes entries down and leaves raising them to the backends; CT6 and X3 stay with that.
- ACP raises a client's entry while the chat's call still streams, which is why a streaming call holds its entry.
- `agent-acp-client-tool.test.ts` moved with the behavior: its case held two rows past the turn that ended.
- On `89ebe4d5`'s sources the two removals and that case fail: each entry stayed.
