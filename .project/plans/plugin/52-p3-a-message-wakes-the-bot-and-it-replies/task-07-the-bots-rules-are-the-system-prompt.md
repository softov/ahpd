---
title: The use of post_message is the system prompt
status: done
depends: [task-03-a-message-wakes-a-back-session.md]
layer: "packages/sdk, packages/bot"
refs:
  - "[code://packages/sdk/src/types/agent.ts#L238](../../../../packages/sdk/src/types/agent.ts#L238) - `Start.instructions`"
  - "[code://packages/agent-claude/src/session/query.ts#L308](../../../../packages/agent-claude/src/session/query.ts#L308) - Claude appends the instructions to its preset"
  - "[code://packages/agent-pi/src/backend.ts#L155](../../../../packages/agent-pi/src/backend.ts#L155) - pi appends them to its system prompt"
  - "[code://packages/agent-cofold/src/turnagent.ts#L295](../../../../packages/agent-cofold/src/turnagent.ts#L295) - cofold joins them with its `instructions` key"
---

## Objective

A session request may carry instructions, and the host adds them to `Start.instructions`.
A back session starts with one instruction: reply to the person with `post_message`.
A host tool may be opt-in, and a session request names the opt-in tools it wants.
`post_message` is opt-in, so only a back session has it.
The bot's rules are not here: they are in `AGENTS.md`, which the harness reads (task 10).
A backend that takes no system prompt gets the instructions in the first message.

## Files

- `UPDATE: packages/sdk/src/types/session.ts` - `instructions` on the session request.
- `UPDATE: packages/sdk/src/plugins/validate.ts` - check `instructions` as an array of strings.
- `UPDATE: packages/sdk/src/host/spawn.ts` - add the request's instructions to `Start.instructions`.
- `UPDATE: packages/sdk/src/types/host.ts` - `optIn` on `HostTool`.
- `UPDATE: packages/sdk/src/host/tooling.ts` - offer an opt-in tool only to a session whose request names it.
- `UPDATE: packages/bot/src/post.ts` - mark `post_message` as opt-in.
- `UPDATE: packages/agent-acp/src/session/opening.ts` - put the instructions before the first message.
- `UPDATE: packages/bot/src/wake.ts` - send the `post_message` instruction as `instructions`.
- `CREATE: packages/sdk/test/session-instructions.test.ts` - the request's instructions and opt-in tools reach the session.
- `UPDATE: packages/bot/test/bot-wake.test.ts` - the back session starts with the instruction.

## Steps

1. Add `instructions?: string[]` to the session request, and check it in `checkSessionRequest`.
2. Add the request's instructions after the host tools' instructions in `Start.instructions`.
3. In agent-acp, write the instructions before the text of the first turn.
4. When task 03 starts a back session, send one instruction in the request.
5. Write the instruction as: a person waits in the main chat, and only `post_message` replies to them.
6. Say in the instruction that `send_message` starts a turn somewhere else and does not reply.
7. Add `optIn?: boolean` to `HostTool`, and `tools?: string[]` to the session request.
8. Offer an opt-in tool only to a session whose request names it in `tools`.
9. Keep the names a session asked for with the session, so a restart offers the same tools.
10. Mark `post_message` as opt-in, and name it in `tools` when the wake starts a back session.

## Validation

- `session-instructions.test.ts`: test that the instructions reach `Start.instructions`.
- `session-instructions.test.ts`: test that the check refuses a value that is not an array of strings.
- `session-instructions.test.ts`: test that an opt-in tool is absent from a session that did not name it.
- `bot-wake.test.ts`: test that the back session's start has the `post_message` instruction and names the tool.
- The gates pass: build, typecheck, boundary, schema and vitest.
