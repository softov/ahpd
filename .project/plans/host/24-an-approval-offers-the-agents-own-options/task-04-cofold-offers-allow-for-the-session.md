---
title: cofold offers "allow for this session"
status: implemented
depends: [task-01-confirm-carries-the-picked-option.md]
layer: "agent-cofold"
refs:
  - "[code://packages/agent-cofold/src/mapping.ts#L381-L436](../../../../packages/agent-cofold/src/mapping.ts#L381-L436) - `approval.requested`, the ready action and the `toolConfirmation` entry"
  - "[code://packages/agent-cofold/src/session.ts#L1350-L1388](../../../../packages/agent-cofold/src/session.ts#L1350-L1388) - `confirm`, which sends `approve` or `deny`"
  - "[code://packages/agent-cofold/test/agent-cofold-approval.test.ts](../../../../packages/agent-cofold/test/agent-cofold-approval.test.ts) - the approval cases"
  - npm://@cofold/agents@^0.1.1 - `alwaysApprove` on the approve command, kept at `approvals/<session>/<tool>`
---

## Objective

A cofold approval offers Allow once, Allow `<tool>` for this session, and Deny; picking the session option sends `alwaysApprove`, and the next call of that tool in the session does not ask.

## Files

- `UPDATE: packages/agent-cofold/src/mapping.ts:381-436` - the three options on the ready action and on the `toolConfirmation` entry's `toolCall`.
- `UPDATE: packages/agent-cofold/src/session.ts:1350-1388` - an approve whose `optionId` is `allow-session` sends `{ type: 'approve', requestId, alwaysApprove: true }`.
- `UPDATE: packages/agent-cofold/test/agent-cofold-approval.test.ts` - the cases below.

## Steps

1. Options: `allow-once` (approve, group 1), `allow-session` labelled `Allow <tool name> for this session` (approve, group 1), `deny` (deny, group 2).
2. Any other approve sends no `alwaysApprove`.

## Validation

- A case: the ready action carries the three options; picking `allow-session` sends `alwaysApprove: true`, and a second call of the same tool in the session runs without an `approval.requested`; a plain approve asks again next time; it fails first.
- The ready action validates against the protocol schema.
- `pnpm typecheck`, `pnpm boundary`, `pnpm test` green.

## Resume

Built.
`approval.requested` in `packages/agent-cofold/src/mapping.ts` puts `allow-once` (approve, group 1), `allow-session` labelled `Allow <display name> for this session` (approve, group 1) and `deny` (deny, group 2) on the held call, on its `chat/toolCallReady` and so on the `toolConfirmation` entry's `toolCall`, and keeps them on the `OpenRequest` as `options`.
`confirm(toolCallId, approved, optionId)` in `packages/agent-cofold/src/session.ts` sends `{ type: 'approve', requestId, alwaysApprove: true }` only when the picked option is `allow-session`; any other approve sends none.
The echo carries `selectedOptionId` when an offered option of the answer's kind was picked, and the held call drops `options` and keeps `selectedOption`.

Tests, in `packages/agent-cofold/test/agent-cofold-approval.test.ts`:

- `offers allow once, allow the tool for this session, and deny`: the ready and the entry carry the three options; both validate with `checker`.
- `allows the tool for the rest of the session when that is picked`: `allow-session` on the first `write`; the echo carries it; the second turn's `write` runs with no second `toolConfirmation` entry.
- `asks again next time when the approval was only for once`: a plain approve, and the second turn's `write` asks again.

Failed first: the first with the options `undefined`, the second with the echo's `selectedOptionId` `undefined`; the third passed before, as it pins today's behaviour.

Departure and question for review: the label uses the tool's display name (`Allow Write a note for this session`) rather than its name (`write`), because the display name is what the row shows a person; cofold keeps the answer by the tool's name either way.

Gates: `pnpm typecheck` clean; `pnpm boundary` clean; `pnpm test` 107 files, 1544 tests passed.
