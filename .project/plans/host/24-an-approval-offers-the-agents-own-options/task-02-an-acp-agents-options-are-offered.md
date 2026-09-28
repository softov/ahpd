---
title: An ACP agent's own options are offered, and the picked one answered
status: todo
depends: [task-01-confirm-carries-the-picked-option.md]
layer: "agent-acp"
refs:
  - "[code://packages/agent-acp/src/session.ts#L388-L445](../../../../packages/agent-acp/src/session.ts#L388-L445) - `askPermission`, which keeps `allow_once` and `reject_once` only"
  - "[code://packages/agent-acp/src/session.ts#L1050-L1073](../../../../packages/agent-acp/src/session.ts#L1050-L1073) - `confirm`, which answers `allow` or `reject`"
  - "[code://packages/agent-acp/src/mapping.ts#L163-L172](../../../../packages/agent-acp/src/mapping.ts#L163-L172) - the ready sent for a `tool_call` with `rawInput`, as `confirmed: 'not-needed'`"
  - "[code://packages/agent-acp/test/fixtures/acp-server.mjs#L296-L303](../../../../packages/agent-acp/test/fixtures/acp-server.mjs#L296-L303) - the fixture offering `yes-once`, `yes-always` and `no-once`"
  - "[code://packages/agent-acp/test/agent-acp-ports.test.ts#L169-L193](../../../../packages/agent-acp/test/agent-acp-ports.test.ts#L169-L193) - the approval cases, which pin the once option today"
---

## Objective

Every option an ACP agent lists in `session/request_permission` is a `ConfirmationOption` on the pending call, and the one the person picks is the `optionId` the agent receives.

## Files

- `UPDATE: packages/agent-acp/src/session.ts:388-445` - keep the agent's whole option list on the pending entry; emit a `chat/toolCallReady` for the pending state carrying `options` and `confirmationTitle`; put `options` on the `toolConfirmation` entry's `toolCall`.
- `UPDATE: packages/agent-acp/src/session.ts:1050-1073` - answer the picked `optionId` when it is one the agent offered, and otherwise the once option of the approved or denied kind.
- `UPDATE: packages/agent-acp/test/agent-acp-ports.test.ts` - the cases below.

## Steps

1. Map `allow_once` and `allow_always` to kind `approve`, `reject_once` and `reject_always` to kind `deny`; `id` is the agent's `optionId`, `label` its `name`; approve options in group 1, deny options in group 2, each in the agent's order.
2. Emit the pending-state `chat/toolCallReady` even when `mapping.ts` already sent a `not-needed` ready for the call, so the row reaches `pending-confirmation` with its options.
3. In `confirm`, an `optionId` the agent did not offer is ignored and the once option of the answer's kind is used, falling back to the `always` of that kind only when no once option exists, and to `cancelled` when neither does.

## Validation

- `agent-acp-ports.test.ts`: the ready action carries three options in approve-then-deny order; picking `yes-always` sends `yes-always`; approve with no option sends `yes-once`; a denial sends `no-once`; each fails first where it changes behaviour.
- The ready action and the input-needed entry validate against the protocol schema (`checker` from `tools/wire.mjs`).
- `pnpm typecheck`, `pnpm boundary`, `pnpm test` green.

## Resume
