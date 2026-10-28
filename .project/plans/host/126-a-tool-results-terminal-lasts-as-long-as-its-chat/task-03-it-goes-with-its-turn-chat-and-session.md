---
title: A kept output goes with its turn, chat and session, and moves with its chat
status: done
depends: [task-01-a-terminals-output-is-kept.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/chatactions.ts#L1484-L1550](../../../../packages/sdk/src/host/chatactions.ts#L1484-L1550) - `chat/truncated`"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L1380-L1414](../../../../packages/sdk/src/host/sessionmethods.ts#L1380-L1414) - `disposeChat`"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L186-L188](../../../../packages/sdk/src/host/sessionmethods.ts#L186-L188) - a move"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L218-L219](../../../../packages/sdk/src/host/sessionmethods.ts#L218-L219) - a move put back"
  - "[code://packages/sdk/src/sessions/sessions.ts#L604-L611](../../../../packages/sdk/src/sessions/sessions.ts#L604-L611) - a session's folder goes with it"
---

## Objective

A truncation takes the outputs the dropped turns name, and a disposed chat takes its folder.
A removed session's folder already goes with it, and a moved chat's folder goes to its new session.

## Files

- `UPDATE: packages/sdk/src/host/outputs.ts` - `forgetTurnOutputs`, `forgetChatOutputs` and `moveChatOutputs`.
- `UPDATE: packages/sdk/src/host/chatactions.ts:1525-1529` - forget what the dropped turns name.
- `UPDATE: packages/sdk/src/host/sessionmethods.ts:186-219` - move the folder with the chat, and back with a refused move.
- `UPDATE: packages/sdk/src/host/sessionmethods.ts:1412-1414` - forget the chat's folder when the chat goes.
- `UPDATE: packages/sdk/test/host-retained-terminals.test.ts` - the cases below.

## Steps

1. Write `forgetTurnOutputs`, which removes each file a terminal content in the turns names, for this chat only.
2. Write `forgetChatOutputs`, which removes the chat's folder in the session's folder.
3. Write `moveChatOutputs`, which moves each file of the chat's folder into the folder of the session it moves to.
4. Call `forgetTurnOutputs` with the turns `chat/truncated` drops, after it says the truncation.
5. Call `forgetChatOutputs` where `disposeChat` drops the chat.
6. Call `moveChatOutputs` after the store moves the chat, and again for a move put back.

## Validation

- A truncation takes the dropped turns' outputs and keeps the kept turns' outputs.
- A dropped turn that names another chat's output leaves this chat's output under the same key.
- A disposed chat's folder is gone, and its address answers as unknown.
- A removed session's folder is gone.
- A moved chat's outputs are in the folder of its new session.
- A refused move leaves them where they were.

## Resume

Done 2026-10-27.
The guard against another chat's output only shows when this chat has an output under the same key, so the case keeps one.
