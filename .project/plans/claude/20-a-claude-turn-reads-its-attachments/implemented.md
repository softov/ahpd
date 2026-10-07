---
title: A Claude turn reads its message's attachments, queued and steered ones included - implemented
date: 2026-10-07
refs:
  - git://1195a06f2e408b07b7439ff111d7a9ec59a57e1c
  - "[code://packages/agent-claude/src/session/attachments.ts](../../../../packages/agent-claude/src/session/attachments.ts)"
  - "[code://packages/agent-claude/src/session/turns.ts](../../../../packages/agent-claude/src/session/turns.ts)"
  - "[code://packages/agent-claude/src/session/query.ts](../../../../packages/agent-claude/src/session/query.ts)"
---

A Claude session now sends a message's attachments to the CLI.
A picture a client pasted reaches the model as a picture.
Small text is inlined into the prompt, and everything else is named by the path the host wrote it to.
The same holds for a message that waits in the queue and for one that steers a running turn.
Until now the backend dropped every attachment, so a client showed chips the agent never saw.

## What was built

- [`code://packages/agent-claude/src/session/attachments.ts`](../../../../packages/agent-claude/src/session/attachments.ts) - `blocksFor(text, attachments)`, which returns the plain string when there are none and otherwise maps `partsOf`'s parts to the CLI's own blocks.
- [`code://packages/agent-claude/src/session/turns.ts`](../../../../packages/agent-claude/src/session/turns.ts) - one `push` door for `begin`, `steer` and the queue, which keeps `message.attachments`.
- [`code://packages/agent-claude/src/session/query.ts`](../../../../packages/agent-claude/src/session/query.ts) - the waiting list is `SDKUserMessage[]`, because a message with attachments carries content blocks.
- [`code://packages/sdk/test/support/claude-sdk.ts`](../../../../packages/sdk/test/support/claude-sdk.ts) - the fake CLI records a prompt that arrived as blocks beside the ones that arrived as strings.
- [`code://packages/agent-claude/test/attachments.test.ts`](../../../../packages/agent-claude/test/attachments.test.ts) - the mapping, over real files.
- [`code://packages/sdk/test/host-input.test.ts`](../../../../packages/sdk/test/host-input.test.ts) - three cases that drive the host end to end and read what reached the CLI.

## Verified

- `packages/agent-claude/test/attachments.test.ts`: 11 tests, all new.
- A message with nothing attached is the same string as before.
- A small pasted image is an image block, and a large one is named by path.
- Text up to 64 KiB is inlined, and larger text is named by path.
- A PDF and a type nothing knows are named by path.
- A file somebody picked is named by path, not inlined.
- The side chat's `carried` prefix stays in the first block.
- A queued message and a steering message each keep their own.
- `packages/sdk/test/host-input.test.ts`: 23 tests, 3 of them new, read off the fake CLI.
- Those three cover the whole path, from `chat/turnStarted` and `chat/pendingMessageSet` through host 68's write of the bytes.
- `pnpm build`, `pnpm typecheck` and `pnpm boundary` pass.
- `npx vitest run` passes: 250 files, 4339 tests.

## Departures from the plan

- Task 01's `## Files` did not name `packages/agent-claude/src/session/query.ts`, which had to change: its waiting list was typed `content: string`.
- The plan asked for "a host test"; the three went into the existing `packages/sdk/test/host-input.test.ts`, which already drives the host through the fake CLI.
- The fake SDK gained a `blocks` list rather than widening `said`, whose twenty existing call sites read strings.
- `refuseTurn` keeps the attachments on the turn it records, so a turn the CLI never took still shows the picture.
- `resume` still sends the text alone, which the plan did not cover.

## Left for later

- A turn resumed with `chat/turnResume` sends its message's text and not its attachments - see [deferred.md](deferred.md).
- A Claude session in a machine reads host 68's files only if the machine can see the attachments folder, which host 68 left open.
