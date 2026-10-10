---
title: The session's agent writes the words
status: done
depends: [task-02-forced-and-session-title-modes.md]
layer: sdk
refs:
  - "[code://packages/sdk/src/types/agent.ts](../../../../packages/sdk/src/types/agent.ts) - `Agent.chats.sideChat`"
---

## Objective

In agent mode, a side chat on the session asks its agent for the words with task 03's prompt.
The main conversation does not change.

## Files

- `UPDATE: packages/sdk/src/changes.ts` - `wordsFor` asks a side chat in agent mode.
- `UPDATE: packages/sdk/src/host/changesets.ts:260-356` - `askAgent` opens the side chat, and `changeWordsOf` answers the ask or says what went without.
- `UPDATE: packages/sdk/src/types/host.ts` - `changeWordsTimeoutMs`, the limit the side chat's turn waits under.
- `UPDATE: packages/sdk/test/changewords.test.ts` - an agent with a side chat, and one without.

## Steps

1. Open a side chat on the session, send task 03's prompt, and read the answer.
2. Close the side chat after the answer.
3. Fall back to the session title when the agent has no side chat, and say so.

## Validation

- Tests cover an agent with a side chat and one without, and the main chat has no new turn.
- The gates pass.

## Resume

- **Implemented** 2026-10-09 on `build/agents/016ab0b2`, uncommitted.
- `packages/sdk/src/host/changesets.ts:260-310` is `askAgent`. It takes the session's newest turn, opens a chat at `ahp-chat://side/${crypto.randomUUID()}` through `ctx.claimable` and `ctx.spawn`, records it in `ctx.madeFrom` as `{ kind: 'sideChat', chat: held.defaultChat, turnId }`, tells the session's clients about it with a `session/chatAdded` action, and runs task 03's prompt as a turn of that chat. The answer is read off the chat's newest turn, and the words are the same `splitWords` over it.
- The side chat's own context is the turn it came from - the message text - rather than the whole conversation, which is what the protocol says a side chat's visible history holds.
- `packages/sdk/test/changewords.test.ts` grew by three tests for this mode.
- The first asks a side chat and keeps it: the session's own chat holds the person's turn and no other, the words were written in a chat of its own, and a client is sent one `session/chatAdded` whose `summary.resource` is that chat.
- The second is an agent without `chats.sideChat`, which falls back with `voice cannot start a side chat, so the session title was used` and opens no chat at all.
- The third is a session that has said nothing: it falls back with `the session has no turn to ask from, so the session title was used`, and the commit keeps `Echo session`.
- **Departure 1.** Step 2 of this task, "Close the side chat after the answer", is superseded. The plan's row "The side chat stays in the session after it answers" says the chat stays, so the `finally` stops the watcher and nothing else. No `session/chatRemoved` is sent and the chat is not disposed of.
- **Departure 2.** `askAgent` builds the chat rather than calling the path a client's `createChat` takes in `sessionmethods.ts`. That path is a request handler and is not on the context, so a call to it from here would have to go out through a connection and back. The two do the same four things - `claimable`, `madeFrom`, `spawn`, `chatAdded` - and this one is the only caller that is not a request.
- **Departure 3.** A session with no turn at all is answered by `changeWordsOf` with `why` before `askAgent` is ever reached, so `askAgent`'s own `newest === undefined` guard is a backstop rather than the path the test exercises. The fallback and its sentence are the same either way.
- The side chat's turn waits under the same limit as a model's. That row was added to the plan after this task was first built. `watchTurn` (task 03) resolves on the turn's end and, past `changeWordsTimeoutMs`, cancels the chat's turn and answers `false`, so the words fall back as for a failure. The chat stays either way, which is what the plan's fourth row decides.
- `packages/sdk/test/changewords.test.ts` has five tests for this mode. They are the side chat asked and kept, an agent without `chats.sideChat`, a session that has said nothing, a side chat whose turn never ends, and `create-pr` under agent mode with both of the chats it opens.
- Gates: `node tools/schema.mjs`, `pnpm build`, `pnpm typecheck` and `pnpm boundary` pass; the full suite is 266 files and 4,716 tests.
