---
title: A turn sends its usage
status: done
depends: []
layer: "agent-pi"
refs:
  - "[code://packages/agent-pi/src/session.ts#L151-L179](../../../../packages/agent-pi/src/session.ts#L151-L179) - `finish`, before whose ending action usage is sent"
  - "[code://packages/agent-pi/src/transcript.ts#L30-L49](../../../../packages/agent-pi/src/transcript.ts#L30-L49) - `turnsOf`"
  - "[code://packages/agent-cofold/src/mapping.ts#L109-L126](../../../../packages/agent-cofold/src/mapping.ts#L109-L126) - `usageOf` to copy"
---

## Objective

A pi turn that had an assistant message emits `chat/usage` before it ends, and its transcript turn carries the same usage.

## Files

- `UPDATE: packages/agent-pi/src/session.ts` - on `agent_settled`, build the usage from the remembered last assistant message and emit it before `finish`; set it on the active turn and on the watched turn.
- `UPDATE: packages/agent-pi/src/types.ts:79-86` - `WatchedTurn.usage?: Bag`.
- `UPDATE: packages/agent-pi/src/transcript.ts:45` - `usage: watched.usage`.
- `UPDATE: test/agent-pi.test.ts` - the cases below.

## Steps

1. A `usageOf(message)` in `session.ts` or `mapping.ts`: `inputTokens` from `usage.input`, `outputTokens` from `usage.output`, `cacheReadTokens` from `usage.cacheRead`, `model` as `provider/model`, and `cacheWriteTokens` in `_meta` when present. A field pi did not report is left out, not sent as zero.
2. Emit `{ type: 'chat/usage', turnId, usage }` on the chat channel, then call `finish`.
3. Store it on `active.usage` and `watched.usage`.

## Validation

- `test/agent-pi.test.ts`: a turn whose last `message_end` carries usage emits `chat/usage` with the mapped fields immediately before `chat/turnComplete`, and `transcript` returns the same usage.
- A `!command` turn and a turn with no assistant message emit no `chat/usage`.
- `pnpm test`, `pnpm typecheck`, `pnpm wire` green.

## Resume

Built.
`usageOf` in `session.ts` reads the remembered last assistant message: `inputTokens`, `outputTokens` and `cacheReadTokens` from pi's `usage`, `model` as `provider/model`, and `cacheWriteTokens` in `_meta`.
On `agent_settled` the usage is set on the active turn and on the watched turn, and emitted as `chat/usage` before the ending action.
`WatchedTurn.usage` and `transcript.ts` carry the same usage, so a client that subscribes reads it.

- `test/agent-pi.test.ts` covers the mapped fields, the order against the ending action, the transcript carrying it, and no usage for a turn with no assistant message or for a `!command` turn.
- `pnpm test` 102 files, 1369 tests; `pnpm typecheck` and `pnpm boundary` green.
