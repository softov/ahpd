---
title: A woken message carries its context
status: done
depends: [task-03-a-message-wakes-a-back-session.md]
layer: "packages/bot"
refs:
  - "[code://packages/bot/src/wake.ts#L256-L270](../../../../packages/bot/src/wake.ts#L256-L270) - `turn` and `steer`, which send only the person's text"
  - "[code://packages/bot/src/wake.ts#L334](../../../../packages/bot/src/wake.ts#L334) - the send of a woken message"
---

## Objective

Each message that wakes a back session has a context block in front of the person's text.
The block says the main chat, the person, and the time.
The block has a fixed shape, so a later plan can add open tasks and memory hints to it.
The system prompt does not change for each message.

## The block

```
<context>
main chat: bot:/<bot>/<user>
from: <the person's name or id>
time: <ISO time with the host's offset>
</context>

<the person's text>
```

## Files

- `CREATE: packages/bot/src/context.ts` - `contextBlock(fields)`, which writes the block from a list of lines.
- `UPDATE: packages/bot/src/wake.ts` - `turn` and `steer` put the block in front of the text.
- `CREATE: packages/bot/test/bot-context.test.ts` - the tests of the block.

## Steps

1. Write `contextBlock` to take a list of name and value pairs and write one line for each.
2. Leave out a line whose value is empty.
3. Make `turn` and `steer` put the block in front of the person's text, with one blank line between.
4. Fill the main chat, the person and the time from the woken message.
5. Keep the text that the main chat shows as the person's text, without the block.

## Validation

- `bot-context.test.ts`: test the block for a turn and for a steer.
- `bot-context.test.ts`: test that the main chat shows only the person's text.
- The gates pass: build, typecheck, boundary, schema and vitest.
