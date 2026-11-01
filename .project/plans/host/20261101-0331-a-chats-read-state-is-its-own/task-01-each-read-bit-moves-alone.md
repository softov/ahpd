---
title: Each read bit moves alone
status: done
depends: []
layer: host
refs:
  - "[code://packages/sdk/src/host/chatactions.ts#L12-L145](../../../../packages/sdk/src/host/chatactions.ts#L12-L145) - `sessionFlag`, `countedChats`, `chatFlag` and `sessionFollows`"
  - "[code://packages/sdk/src/host/chatactions.ts#L216-L271](../../../../packages/sdk/src/host/chatactions.ts#L216-L271) - a client's chat bit"
  - "[code://packages/sdk/src/host/spawn.ts#L1469-L1500](../../../../packages/sdk/src/host/spawn.ts#L1469-L1500) - a turn's start and end"
  - "https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/chatContributions/markUnread/markUnreadContribution.ts#L27-L48 - a turn's end marks its chat unread, then a read session"
  - "https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/common/state/sessionState.ts#L2063-L2070 - the chats whose turn's end leaves the session as it is"
---

## Objective

`chat/isReadChanged` and `session/isReadChanged` each move one bit and its summaries.
A turn's start clears its chat's bit, with the session's bit left as it is.
A turn's end marks its chat unread, then a read session unread with its own action, unless the chat is a tool's or hidden.
A chat archived on its own is marked read, with the session's bit left as it is.

## Files

- `UPDATE: packages/sdk/src/host/chatactions.ts:12-75` - `sessionFlag` moves the session's read bit alone.
- `DELETE: packages/sdk/src/host/chatactions.ts:77-89` - `countedChats`, whose one use is to move one read bit with another.
- `DELETE: packages/sdk/src/host/chatactions.ts:129-145` - `sessionFollows`, the session's bit moved with a chat's.
- `UPDATE: packages/sdk/src/host/chatactions.ts:216-271` - a client's chat bit, and a chat's archive, move the chat's bits alone.
- `UPDATE: packages/sdk/src/host/spawn.ts:1469-1500` - a turn's start moves the chat's bit, and a turn's end the chat's and then a read session's, with the reference cited.
- `UPDATE: packages/sdk/src/host/spawn.ts:382-384` - a worker chat's bit at a turn's start, its comment.
- `UPDATE: packages/sdk/src/host/spawn.ts:513-515` - a worker chat's bit at its end, its comment and the reference.
- `UPDATE: packages/sdk/test/host-catalogue.test.ts:501-751` - each bit moves alone, through a client's action, a turn and an archive.
- `UPDATE: packages/sdk/test/ahp-test-cases.test.ts:253-257` - the rule that case 072 broke, which no case breaks now.
- `UPDATE: packages/sdk/test/ahp-test-cases.test.ts:416` - case 072, with no divergence.
- `UPDATE: packages/sdk/test/subagent-chat.test.ts:787-826` - a worker's end leaves the session as it is, after the lead turn's end marked it.

## Steps

1. Write the tests, and run them on `c7899eff` to see each fail for the reason it names.
2. Take case 072 out of `DIVERGES`, and run it on `c7899eff` to see its `chats` differ.
3. Move only the session's bit in `sessionFlag`.
4. Move only the chat's bit after a client's chat action and a chat's archive.
5. Move only the chat's bit at a turn's start.
6. Mark the chat at a turn's end, then a read session, unless the chat is a tool's or hidden.
7. Delete `countedChats` and `sessionFollows`.
8. Run the tests again, and the protocol cases.

## Validation

- `host-catalogue.test.ts`: a chat's action leaves the session's bit and the sibling chat's as they were.
- `host-catalogue.test.ts`: a session's action leaves every chat's bit as it was.
- `host-catalogue.test.ts`: a turn's start moves the chat's bit and leaves the session's.
- `host-catalogue.test.ts`: a turn's end, failure and stop mark the chat, then a read session.
- `subagent-chat.test.ts`: a worker's end leaves the session's bit as it was.
- `host-terminals.test.ts`: a `!` command's end leaves the session's bit as it was.
- `host-catalogue.test.ts`: an archive marks the chat read and leaves the session's bit.
- `ahp-test-cases.test.ts`: case 072 passes with no divergence.
- Run the suites of every test file that reads a read bit.

## Resume

Built 2026-11-01 in `252f8c74`, and the session's mark at a turn's end added the same day.

- The reference host's turn's end marks the chat at its lines 27-39, and the host's turn's end keeps that, cited at `spawn.ts`.
- Its lines 40-48 then send `session/isReadChanged` false to a read session, as an action of the session's own.
- `isChatInSessionReadAggregate` only filters on the turn's own chat: a tool's chat or a hidden one leaves the session as it is.
- That half was first left out as an aggregate, and is built now: a turn's end is neither client action, and derives no summary field.
- Every chat a session holds here has a person's origin and full interactivity, so only a worker's end skips the session.
- A refused turn never starts here, so no turn's end stands for the reference's rejected request.
- A `!` command turn's end puts back its chat's bit, as plan 89's answer has it, and leaves the session's.
- The reference's line 28 says the same of a local command: "Local commands preserve read state".
- A worker's end marks its chat unread; the reference fires its turn's end for a worker chat too.
- Eight tests of a session's activity read the whole status, read bit included, which a turn's start leaves set.
- They read the status without the read bit, as agent-acp's `statusAtEnd` does.
