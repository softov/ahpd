---
title: A peer chat runs under its own backend id
status: todo
depends: []
layer: "sdk, agent-claude, agent-pi, agent-cofold"
refs:
  - "[code://packages/sdk/src/types/agent.ts#L130-L215](../../../../packages/sdk/src/types/agent.ts#L130-L215) - `Start`, where `chatId` goes"
  - "[code://packages/sdk/src/host/tooling.ts#L297-L308](../../../../packages/sdk/src/host/tooling.ts#L297-L308) - the internal `createChat`"
  - "[code://packages/sdk/src/host/spawn.ts#L311-L320](../../../../packages/sdk/src/host/spawn.ts#L311-L320) - `spawn`"
  - "[code://packages/agent-claude/src/session.ts#L2308](../../../../packages/agent-claude/src/session.ts#L2308) - Claude's `sessionId`"
  - "[code://packages/agent-pi/src/session.ts#L655-L662](../../../../packages/agent-pi/src/session.ts#L655-L662) - pi's `id`"
  - "[code://packages/agent-cofold/src/session.ts#L188-L194](../../../../packages/agent-cofold/src/session.ts#L188-L194) - cofold's `sessionId`"
  - "[code://packages/agent-claude/test/agent-claude-options.test.ts](../../../../packages/agent-claude/test/agent-claude-options.test.ts) - the query options a fake SDK records"
  - "[code://packages/agent-pi/test/agent-pi.test.ts](../../../../packages/agent-pi/test/agent-pi.test.ts) - pi on a fake backend"
  - "[code://packages/agent-cofold/test/agent-cofold-store.test.ts](../../../../packages/agent-cofold/test/agent-cofold-store.test.ts) - cofold's stored conversations"
---

## Objective

`Start.chatId` names the backend conversation a chat runs under; the host sets it for a peer chat to the uuid of its URI and leaves it absent for the default chat; Claude, pi and cofold use it in place of the session's id, so two chats of a session are two conversations.

## Files

- `UPDATE: packages/sdk/src/types/agent.ts` - `Start.chatId?: string`, documented: absent means the session's own id.
- `UPDATE: packages/sdk/src/host/spawn.ts`, `packages/sdk/src/host/tooling.ts`, `packages/sdk/src/host/lifecycle.ts` - `spawn` takes and passes `chatId`; the internal `createChat` passes the uuid of `ahp-chat:/<uuid>`; `restartChat` passes it on.
- `UPDATE: packages/agent-claude/src/claude.ts`, `packages/agent-claude/src/session.ts:2308` - `sessionId: start.chatId ?? idOf(uri)` when not resuming.
- `UPDATE: packages/agent-pi/src/session.ts:659` - `id: start.chatId ?? idFor(start.uri)`.
- `UPDATE: packages/agent-cofold/src/session.ts:192-194` - `start.resume ?? start.chatId ?? sessionIdOf(start.uri)`.
- `UPDATE: packages/agent-claude/test/agent-claude-options.test.ts`, `packages/agent-pi/test/agent-pi.test.ts`, `packages/agent-cofold/test/agent-cofold-store.test.ts`, `packages/sdk/test/host.test.ts` - the cases below.

## Steps

1. Add the field and thread it through `spawn`; a fork keeps its own new id and ignores `chatId`.
2. Change the three backends; ACP and the nested host read nothing new.

## Validation

- `packages/agent-claude/test/agent-claude-options.test.ts`: a start with `chatId` passes it as `sessionId`; without it, the session's uuid as today; with `resume`, no `sessionId`.
- `packages/agent-pi/test/agent-pi.test.ts`: a start with `chatId` opens pi with that `id`.
- `packages/agent-cofold/test/agent-cofold-store.test.ts`: two starts on one session URI with different `chatId`s keep two conversations; a turn in one does not appear in the other.
- `packages/sdk/test/host.test.ts`: with a fake agent recording `Start`, `createChat` sends `chatId` equal to the uuid of the chat URI it answers, and the session's first chat sends none.
- `pnpm test` passes.

## Resume
