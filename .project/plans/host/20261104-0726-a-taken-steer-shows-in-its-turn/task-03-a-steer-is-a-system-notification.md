---
title: A steer is a system notification
status: implemented
depends:
  - task-01-the-bot-chat-shows-a-steer.md
  - task-02-claude-shows-a-steer-it-took-in.md
layer: sdk
refs:
  - "[code://packages/sdk/src/sessions/steer.ts](../../../../packages/sdk/src/sessions/steer.ts) - `steerQuote`, the markdown part this task replaces"
  - "[code://packages/bot/src/chat.ts#L410-L420](../../../../packages/bot/src/chat.ts#L410-L420) - the read back, which matches a steer by its part id"
  - "[code://packages/bot/src/chat.ts#L868-L874](../../../../packages/bot/src/chat.ts#L868-L874) - `notice`, a `systemNotification` part with no id"
---

## Objective

A taken steer shows in its turn as a `systemNotification` part with the message text.
`_meta['ahpd.steer']` names the steering message, so a read back finds the part by it.

## Files

- `UPDATE: packages/sdk/src/sessions/steer.ts` - `steerPart(id, text)` and `steerOf(part)` replace `steerQuote`.
- `UPDATE: packages/sdk/src/index.ts` - export `steerPart` and `steerOf`.
- `UPDATE: packages/sdk/src/host/localturns.ts` - the fold adds `steerPart`.
- `UPDATE: packages/bot/src/chat.ts` - `steer` adds `steerPart`, and the read back matches a steer with `steerOf`.
- `UPDATE: packages/agent-claude/src/session/query.ts` - the live steer adds `steerPart`.
- `UPDATE: packages/agent-claude/src/transcript.ts` - the reader adds `steerPart`.
- `UPDATE: packages/bot/test/bot-chat.test.ts` - expect the steer part.
- `UPDATE: packages/agent-claude/test/agent-claude-late-steer.test.ts` - expect the steer part.
- `UPDATE: packages/sdk/test/host-local-turns.test.ts` - expect the steer part.
- `UPDATE: packages/sdk/test/localturns.test.ts` - expect the steer part.

## Steps

1. Write `steerPart(id, text)`, which returns `{ kind: 'systemNotification', content: text, _meta: { 'ahpd.steer': id } }`.
2. Write `steerOf(part)`, which returns the id in `_meta['ahpd.steer']`, or `undefined`.
3. Replace each `steerQuote` call with `steerPart`.
4. In the bot read back, match a steer by `steerOf`, not by the part id.
5. Change the tests to expect the steer part.

## Validation

- The changed tests fail without the change and pass with it.
- `pnpm build`, `pnpm typecheck` and `pnpm boundary` pass.
- The sdk, agent-claude and bot tests pass, one at a time.

## Resume
