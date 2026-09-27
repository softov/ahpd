---
title: A turn with no model reaches the person as the sentence that says what to add
status: todo
depends: []
layer: "agent-cofold"
refs:
  - "[code://packages/agent-cofold/src/agent.ts#L233-L269](../../../../packages/agent-cofold/src/agent.ts#L233-L269) - `connectionOf`, the sentence"
  - "[code://packages/agent-cofold/src/session.ts#L783-L808](../../../../packages/agent-cofold/src/session.ts#L783-L808) - `startTurn`, which refuses the turn with it"
  - "[code://packages/agent-cofold/test/agent-cofold-turn.test.ts#L407-L434](../../../../packages/agent-cofold/test/agent-cofold-turn.test.ts#L407-L434) - the case that pins the failure"
---

## Objective

This task is a check, made by reading VS Code: with no model configured and none sent, the person sees the sentence decision [a-cofold-turn-with-no-model-fails-and-says-where-to-name-one](../../../decisions/a-cofold-turn-with-no-model-fails-and-says-where-to-name-one.md) gives, in VS Code as in the protocol.

## Files

- `UPDATE: packages/agent-cofold/src/session.ts:783-808` - only if VS Code draws nothing for the refusal as it is sent.

## Steps

1. Read what VS Code draws for the refusal `startTurn` sends (`chat/error` on the turn) in `/github/externals/vscode` under `src/vs/workbench/contrib/chat`.
2. If it draws the sentence, nothing changes and the Resume says where it is drawn.
   If it draws nothing or something else, stop and ask Softov before changing what is sent.

## Validation

This task changes nothing unless VS Code draws nothing for the refusal, so it has no case that fails first; its proof is the reading of VS Code in the Resume.

- The existing case in `agent-cofold-turn.test.ts` still passes.
- By hand, for Softov: with no `"model"` in the cofold configuration and "default" picked in VS Code, the turn shows the sentence naming the file.

## Resume
