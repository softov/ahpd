---
title: A provider error fails the turn
status: done
depends: []
layer: "agent-pi"
refs:
  - "[code://packages/agent-pi/src/session.ts#L182-L236](../../../../packages/agent-pi/src/session.ts#L182-L236) - `heard`, where the settle is handled"
  - "[code://packages/agent-pi/src/session.ts#L151-L179](../../../../packages/agent-pi/src/session.ts#L151-L179) - `finish('error', why)` already emits `chat/error` and seals the turn as `error`"
  - "[code://packages/agent-pi/src/session.ts#L277-L331](../../../../packages/agent-pi/src/session.ts#L277-L331) - `begin`, where per-turn state is reset"
  - npm://@earendil-works/pi-ai@^0.87.1 - `AssistantMessage.stopReason` and `errorMessage`
---

## Objective

A turn whose last assistant message ended with `stopReason: 'error'` ends as `error` with pi's `errorMessage`, and a turn pi retried and then answered still ends as `complete`.

## Files

- `UPDATE: packages/agent-pi/src/session.ts:182-236` - remember the last assistant message of the running turn on `message_end`; decide the ending on `agent_settled` from it.
- `UPDATE: test/agent-pi.test.ts` - the cases below.

## Steps

1. Hold `let answered: { stopReason?: string; errorMessage?: string } | undefined`, reset in `begin`.
2. In `heard`, on `message_end` whose `message.role` is `assistant`, overwrite it with that message's `stopReason` and `errorMessage`. Each new assistant message replaces the last, so a retried error is forgotten when the retry answers.
3. On `agent_settled`: `cancelled` stays `cancelled`; otherwise `stopReason === 'error'` is `finish('error', errorMessage)`, and anything else is `complete`.
4. Keep `finish`'s existing fallback text for an error with no message.
5. Plan 04 reads the same remembered message for usage, so keep the whole message, not only the two fields, if that is simpler.

## Validation

- `test/agent-pi.test.ts`: `message_end` with an assistant message `{ stopReason: 'error', errorMessage: '429 rate limited' }` then `agent_settled` emits `chat/error` with that message, `status()` is `Error`, and the transcript turn is `error`.
- An error `message_end`, `agent_end` with `willRetry`, an answering `message_end` with `stopReason: 'stop'`, then `agent_settled` ends `complete`.
- A cancelled turn whose last message is `aborted` ends `cancelled`.
- `pnpm test`, `pnpm typecheck` green.

## Resume

Built.
`session.ts` holds `answered`, the last assistant message of the running turn, reset in `begin` and overwritten on every assistant `message_end`.
`agent_settled` judges the ending from it: `cancelled` stays `cancelled`, `stopReason: 'error'` is `finish('error', errorMessage)`, and anything else is `complete`.
The whole message is kept rather than two fields, which is what plan 04 reads for usage.

- `test/agent-pi.test.ts` covers an error message failing the turn with the provider's text, an error followed by a retry that answered ending `complete`, and an aborted last message on a cancelled turn staying `cancelled`.
- `pnpm test`, `pnpm typecheck` and `pnpm boundary` green.
