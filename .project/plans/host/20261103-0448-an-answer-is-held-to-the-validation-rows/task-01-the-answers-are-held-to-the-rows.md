---
title: The answers are held to the rows
status: done
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
- `UPDATE: packages/sdk/test/host-input.test.ts` - the synced draft is submitted before the acceptance.
- `UPDATE: packages/sdk/test/nested-proxy.test.ts` - the answer from outside is a submitted one.
- `UPDATE: packages/sdk/test/notes.test.ts` - the note is answered with a submitted selected value.
- `UPDATE: examples/notes/agent.ts` - the note's name is read from the answer's `value` and `freeformValues`.

## Steps

1. Refuse an acceptance whose required question's answer is not `submitted`.
2. Refuse an answer that needs a value and carries none.
3. Check the payload of a listed kind, and take any other kind.
4. Add the cases of a draft acceptance and an unlisted kind.
5. Describe both checks in the `chat/inputAnswerChanged` row.
6. Send a submitted answer in each case that accepts a required question.
7. Read the notes example's answer by the protocol's payload fields.

## Validation

- `packages/sdk/test/host-input-needed.test.ts`: the two new cases fail on `cde4dd6c` and pass after.
- The input-needed test file passes.
- `pnpm run typecheck` is clean.

## Resume

Built 2026-11-03.

- On `cde4dd6c`'s sources the draft acceptance is taken and the unlisted kind refused, so both new cases fail.
- Three cases accepted a required question with answers no row takes, and send submitted ones.
- The notes example read an `optionId` that no answer kind carries.
