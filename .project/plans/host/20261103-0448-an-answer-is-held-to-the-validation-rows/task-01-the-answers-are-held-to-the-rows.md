---
title: The answers are held to the rows
status: todo
depends: []
layer: host
refs:
  - "[code://packages/sdk/src/host/chatactions.ts#L1852-L1875](../../../../packages/sdk/src/host/chatactions.ts#L1852-L1875) - an acceptance's check"
  - "[code://packages/sdk/src/host/chatactions.ts#L2085-L2106](../../../../packages/sdk/src/host/chatactions.ts#L2085-L2106) - an answer's check"
---

## Objective

An acceptance whose required question has no `submitted` answer, synced or carried, is refused.
An answer with no value, or a listed kind with no payload, is refused, and a kind the protocol does not list is taken.

## Files

- `UPDATE: packages/sdk/src/host/chatactions.ts:1852-1875` - a required question stands answered only by a submitted answer.
- `UPDATE: packages/sdk/src/host/chatactions.ts:2085-2106` - the payload is checked only for the five listed kinds.
- `UPDATE: packages/sdk/test/host-input-needed.test.ts:117-146` - a draft acceptance, an answer with no value, and an unlisted kind.
- `UPDATE: docs/sdk/AHP.md` - the `chat/inputAnswerChanged` row.

## Steps

1. Refuse an acceptance whose required question's answer is not `submitted`.
2. Refuse an answer that needs a value and carries none.
3. Check the payload of a listed kind, and take any other kind.
4. Add the cases of a draft acceptance and an unlisted kind.
5. Describe both checks in the `chat/inputAnswerChanged` row.

## Validation

- `packages/sdk/test/host-input-needed.test.ts`: the two new cases fail on `cde4dd6c` and pass after.
- The input-needed test file passes.
- `pnpm run typecheck` is clean.

## Resume

Not started.
