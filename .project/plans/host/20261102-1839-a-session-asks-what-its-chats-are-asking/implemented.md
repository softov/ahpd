---
title: A session asks what its chats are asking - implemented
date: 2026-11-02
refs:
  - git://90efda43 - the last change
  - "[code://packages/sdk/src/host/catalogue.ts](../../../../packages/sdk/src/host/catalogue.ts)"
  - "[code://packages/sdk/src/host/chatactions.ts](../../../../packages/sdk/src/host/chatactions.ts)"
  - "[code://packages/agent-acp/src/session/handlers.ts](../../../../packages/agent-acp/src/session/handlers.ts)"
  - "[code://packages/bot/src/chat.ts](../../../../packages/bot/src/chat.ts)"
---

A session's entries say what its chats still ask: each goes once its request resolves, and every one of a chat goes with its turn.
An answer is held to its request, as the specification asks.
A draft answer is taken on any chat, for any backend.
ACP and the bot end no request in no client's name.

## What was built

- [`code://packages/sdk/src/host/catalogue.ts`](../../../../packages/sdk/src/host/catalogue.ts) - `askedLeft`, which takes down each entry its chat no longer holds open.
- [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts) - the answer checks, and the draft for every backend.
- [`code://packages/sdk/src/host/channels.ts`](../../../../packages/sdk/src/host/channels.ts) - a worker's chat takes a draft.
- [`code://packages/agent-acp/src/session/handlers.ts`](../../../../packages/agent-acp/src/session/handlers.ts) and [`code://packages/bot/src/chat.ts`](../../../../packages/bot/src/chat.ts) - no ending in nobody's name.
- [`code://packages/sdk/test/host-input-needed.test.ts`](../../../../packages/sdk/test/host-input-needed.test.ts) - the entries, the checks and the draft.

## Verified

- Each new or changed case fails on the sources before its task and passes with it, as each task's *Resume* names.
- The sdk, agent-claude, agent-pi, agent-cofold, agent-acp and bot test files pass, each timeout under load passing alone.
- `pnpm run typecheck` and `pnpm run boundary` report no errors.

## Departures from the plan

- Task 01 - the plan first derived every entry from the chat's call; the build takes entries down and leaves raising them to the backends.
- The reason is in task 01's *Resume*: a client's call on the chat carries the model's tool name.

## Left for later

- Not built: CT6 and X3, which need the host to raise each entry from the chat's call, as VS Code's host does.
- That needs a client's call on the chat to carry the client's own tool name.
- VS Code's chat runs a client's call by the entry's `toolCall.toolName` ([agentHostSessionHandler.ts#L3083-L3095](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostSessionHandler.ts#L3083-L3095)).
- Open, left as it is: Q7, a request ACP's agent raises with no turn, which the reducer drops.
- Neither source says what ACP answers its agent then.
- Open, left as it is: CT13, a stop answering a background worker's questions.
- VS Code's host cancels a chat's subagent sessions on a stop; what that does to their questions was not read.
