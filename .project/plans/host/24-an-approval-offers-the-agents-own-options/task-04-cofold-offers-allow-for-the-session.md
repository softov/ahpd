---
title: cofold offers "allow for this session"
status: todo
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
