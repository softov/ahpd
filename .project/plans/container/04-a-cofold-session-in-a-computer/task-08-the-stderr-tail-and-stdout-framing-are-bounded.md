---
title: The stderr tail and the stdout framing are bounded
status: todo
depends: [task-07-the-inner-hosts-pipes-cannot-crash-the-daemon.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/nested.ts#L155-L172](../../../../packages/sdk/src/nested.ts#L155-L172) - stdout reassembly and the stderr line split"
  - "[code://packages/sdk/src/nested.ts#L37-L38](../../../../packages/sdk/src/nested.ts#L37-L38) - `TAIL`, twelve lines of any length"
---

## Objective

A failure's sentence carries at most a bounded number of characters of the inner host's stderr, a stderr line split across two chunks is one line, and a large stdout frame is reassembled in time proportional to its size.

## Files

- `UPDATE: packages/sdk/src/nested.ts:155-172` - `out += chunk` and `indexOf` from the start on every chunk; stderr split per chunk with no carried remainder.
- `UPDATE: packages/sdk/src/nested.ts:37-38` - `TAIL`.

## Steps

1. Carry the unterminated remainder of stderr between chunks, the way stdout already does, so a line is kept whole.
2. Cap each kept stderr line (for example 400 characters, cut with an ellipsis) beside the twelve-line `TAIL`.
3. Keep stdout's scan position between chunks, or collect chunks in an array and join only when a newline arrives, so each byte is scanned once.

## Validation

- `test/nested-proxy.test.ts`, with the fake's `say` able to emit a raw chunk without a trailing newline:
  - a 100 000-character stderr line followed by an exit ends with a sentence shorter than 6 000 characters; today the whole line is in it;
  - `ahpd: no plugin` sent as `ahpd: no ` and `plugin\n` in two chunks is one tail entry; today it is two, joined by ` | `;
  - a 32 MiB frame fed in 64 KiB chunks reaches `AhpClient` within 3 s; measure it today first and raise the size until today's code misses the bound.
- `node_modules/.bin/vitest run test/nested-proxy.test.ts` passes.

## Resume
