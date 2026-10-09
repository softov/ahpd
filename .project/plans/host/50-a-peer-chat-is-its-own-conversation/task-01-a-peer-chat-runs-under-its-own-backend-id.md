---
title: A peer chat runs under its own backend id
status: done
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
- `UPDATE: packages/agent-claude/test/agent-claude-options.test.ts`, `packages/agent-pi/test/agent-pi.test.ts`, `packages/agent-cofold/test/agent-cofold-store.test.ts`, `packages/sdk/test/host-chats.test.ts` - the cases below.

## Steps

1. Add the field and thread it through `spawn`: a chat is handed the uuid of its URI.
2. Change the three backends to read it in place of the session's id.
3. Leave a fork under the id the backend mints, which is what the record keeps.

## Validation

- `packages/agent-claude/test/agent-claude-options.test.ts`: a start with `chatId` passes it as `sessionId`; without it, the session's uuid as today; with `resume`, no `sessionId`.
- `packages/agent-pi/test/agent-pi.test.ts`: a start with `chatId` opens pi with that `id`.
- `packages/agent-cofold/test/agent-cofold-store.test.ts`: two starts on one session URI with different `chatId`s keep two conversations; a turn in one does not appear in the other.
- `packages/sdk/test/host-chats.test.ts`, in `more than one chat in a session`: with a fake agent recording `Start`, `createChat` sends `chatId` equal to the uuid of the chat URI it answers, and the session's first chat sends none.
- `pnpm test` passes.

## Resume

Built on `build/agents/830a472f` on 2026-10-09 and left uncommitted.

`Start.chatId` is in `packages/sdk/src/types/agent.ts`. `chatIdFor(session, chatUri)` in `packages/sdk/src/host/channels.ts` states the rule in one place: the default chat names none, and any other chat names `idOf(chatUri)`. `spawn` takes it as a fourth argument, and puts it on the `Start` only when there is one of it. The seven call sites pass it: `tooling.ts`, `sessionmethods.ts`, `lifecycle.ts` three times, and `chatactions.ts` twice.

Claude reads it in `query.ts`. Both sites that name a first query call `namedUnder(...)`. The argument is `ctx.options.chatId ?? idOf(ctx.options.uri)`. pi reads it in `session.ts` as `writtenAs`, which is `start.chatId ?? idFor(start.uri)`. cofold reads it as `start.resume ?? start.chatId ?? sessionIdOf(start.uri)`, so a resume still wins. ACP and the nested host read nothing new.

Step 3 is what a fork does. A fork resumes the conversation it was cut from with `forkSession`, and the CLI names the continuation itself, so the uuid the host asked for is not the one the fork runs under. `agentId()` is the answer, and `spawn` writes it into the record when a turn of that chat ends, which is the first moment it is known.

Four test files. Three are the backend suites in Validation. The fourth is `packages/sdk/test/host-chats.test.ts`, where a recording agent wrapped over `claude()` shows `createChat` sending the chat URI's uuid. The session's first chat sends none.

One file the Files line does not name: `packages/sdk/src/host/sessionmethods.ts`, where the client's `createChat` spawns. It is the seventh call site and the behaviour is the one the task decides.
