---
title: Audio is served
status: done
depends: [task-04-images-are-served.md]
layer: "server"
refs:
  - "[code://packages/server/src/proxy/providers.ts#L24-L29](../../../../packages/server/src/proxy/providers.ts#L24-L29) - `ModelPrice`"
  - "[code://packages/server/src/proxy/listener.ts#L273-L284](../../../../packages/server/src/proxy/listener.ts#L273-L284) - `costOf`"
  - "[code://packages/server/src/proxy/dialects.ts#L226](../../../../packages/server/src/proxy/dialects.ts#L226) - `usageReader`, which gives no tokens for a binary answer"
  - https://github.com/openai/openai-openapi - `speech`, `transcriptions` and `translations`, and their usage
---

## Objective

`POST /audio/speech` answers audio bytes, and is charged by the characters of its input.
`POST /audio/transcriptions` and `/audio/translations` take a multipart body, and are charged by tokens or by minutes.

## Files

- `UPDATE: packages/sdk/src/types/connectors.ts` - `openai-speech` and `openai-transcriptions` in `MODEL_DIALECTS`.
- `UPDATE: packages/server/src/proxy/providers.ts` - `characters` and `minutes` in `ModelPrice` and in its schema.
- `UPDATE: packages/server/src/proxy/dialects.ts` - the two rows, and a reader for `usage.seconds` and the token shape.
- `UPDATE: packages/server/src/proxy/listener.ts` - the characters of a speech `input`, and `costOf` for characters and minutes.
- `UPDATE: packages/server/src/proxy/adapters.ts` - `openai` and `openrouter` accept both dialects.
- `CREATE: packages/server/test/proxy-audio.test.ts` - speech bytes and their charge, a transcription by tokens, and one by seconds.

## Steps

1. Add `openai-speech` and `openai-transcriptions` to `MODEL_DIALECTS`.
2. Add the speech row: `/audio/speech` at the root and under `/v1`, family `openai`.
3. Add the transcriptions row: `/audio/transcriptions` and `/audio/translations`, at the root and under `/v1`.
4. Add `characters`, dollars per million characters, and `minutes`, dollars per minute, to `ModelPrice`.
5. Count the characters of a speech body's `input` before the call goes out.
6. Pass the speech answer's bytes through as they arrive.
7. Charge a speech call its characters at `price.characters`, and record no cost without that price.
8. Read a transcription's `usage` as tokens, or as `seconds` charged at `price.minutes`.
9. Make `openai` and `openrouter` accept both dialects.
10. Test that speech bytes arrive unchanged and the record has the character charge.
11. Test a transcription charged by tokens and one charged by seconds.

## Validation

- `proxy-audio.test.ts` passes.
- A file without `characters` or `minutes` loads as before.
- The gate passes: `pnpm -s typecheck && pnpm -s build && pnpm -s boundary && pnpm -s test`.

## Resume
