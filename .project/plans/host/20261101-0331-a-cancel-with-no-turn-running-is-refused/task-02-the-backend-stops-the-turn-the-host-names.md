---
title: The backend stops the turn the host names
status: todo
depends: [task-01-a-stop-with-no-turn-running-is-refused.md]
layer: "host, bot"
refs:
  - "[code://packages/sdk/src/host/chatactions.ts#L1188-L1198](../../../../packages/sdk/src/host/chatactions.ts#L1188-L1198) - the echo is owed under the running turn, and the backend is handed the client's id"
  - "[code://packages/sdk/src/types/session.ts#L629-L630](../../../../packages/sdk/src/types/session.ts#L629-L630) - `cancel`"
  - "[code://packages/bot/src/chat.ts#L1015-L1029](../../../../packages/bot/src/chat.ts#L1015-L1029) - the bot's stop"
  - "[code://packages/agent-acp/test/agent-acp-turn.test.ts#L728-L747](../../../../packages/agent-acp/test/agent-acp-turn.test.ts#L728-L747) - a stop that reaches the ACP server ends the turn once"
  - "[code://packages/agent-cofold/test/agent-cofold-turn.test.ts#L408-L423](../../../../packages/agent-cofold/test/agent-cofold-turn.test.ts#L408-L423) - a stop through the host ends a cofold turn once"
---

## Objective

A stop of the running turn reaches the backend under that turn's own id, a stop that names no turn included.
`Session.cancel` says the host calls it with the id of the turn the chat runs, and only while one runs.
The bot's stop reads that contract, as pi, ACP and cofold already do.

## Files

- `UPDATE: packages/sdk/src/host/chatactions.ts:1188-1198` - hand `session.cancel` the running turn's id.
- `UPDATE: packages/sdk/src/types/session.ts:629-630` - the contract of `cancel`.
- `UPDATE: packages/bot/src/chat.ts:1015-1029` - the stop ends the open turn the host names.
- `UPDATE: packages/agent-acp/test/agent-acp-turn.test.ts` - a stop that names no turn ends the running turn, and reaches the server.
- `UPDATE: packages/agent-cofold/test/agent-cofold-turn.test.ts` - a stop that names no turn ends the running turn.

## Steps

1. Write the ACP and cofold tests, and run them on `c7899eff` to see each turn run on.
2. Hand `session.cancel` the running turn's id in the host.
3. Write the contract on `Session.cancel`.
4. Compare the bot's open turn with the id the host hands it, as the other backends do.
5. Run the tests again, and the bot's suite.

## Validation

- `agent-acp-turn.test.ts`: a stop that names no turn ends the turn with one `chat/turnCancelled`.
- `agent-cofold-turn.test.ts`: the same through cofold.
- `bot-chat.test.ts` passes.

## Resume
