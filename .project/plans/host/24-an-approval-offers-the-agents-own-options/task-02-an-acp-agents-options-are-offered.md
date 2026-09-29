---
title: An ACP agent's own options are offered, and the picked one answered
status: done
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

Built.
`confirmationOptions` in `packages/agent-acp/src/mapping.ts` turns the request's `PermissionOption`s into `ConfirmationOption`s: `allow_once` and `allow_always` as `approve` in group 1, then `reject_once` and `reject_always` as `deny` in group 2, each in the server's order, `id` the server's `optionId` and `label` its `name`; an unknown kind is left out.
`ConfirmationOption` is a local type in `packages/agent-acp/src/types.ts`, because agent-acp does not depend on the protocol package and no dependency was added.
`askPermission` keeps the whole list on the pending entry, sets `options` and `confirmationTitle` on the held call (so the snapshot and the `toolConfirmation` entry's `toolCall` carry them), and emits a `chat/toolCallReady` with no `confirmed`, `options`, `confirmationTitle`, `invocationMessage` and the input, which moves a call announced as running back to `pending-confirmation`.
`confirm(toolCallId, approved, optionId)` sends the picked option when the server offered it and its kind matches the answer; otherwise the once option of the answer's kind; with none, `cancelled`.
The echo carries `selectedOptionId` when an offered option was used, and the held call drops `options` and `confirmationTitle` and keeps `selectedOption`, which is what the reducer does.

Tests, in `packages/agent-acp/test/agent-acp-ports.test.ts`:

- `offers every option the server listed, on the call and on the ask`: the ready has no `confirmed`, the three options in approve-then-deny order and the title; the input-needed entry's `toolCall.options` is the same; the chat snapshot shows the call `pending-confirmation` with the options; the ready and the entry validate with `checker`.
- `answers with the option the person picked, and says which`: `selectedOptionId: 'yes-always'` reaches the server as `yes-always`, and the echo carries it and validates.
- `answers once when the option picked is not one the server offered`: `forever` sends `yes-once`.
- The existing `asks the person, and answers with the once option they chose` and `answers a refusal with the reject option, not with an approval` still pin `yes-once` and `no-once`.

Failed first: the first with `expected 'not-needed' to be undefined` (no pending ready was sent), the second with `perm=yes-once` for `yes-always`.
The third passed before and after; it pins the fallback.

Departures and questions for review:

- Step 3 says an answer with no usable option falls back to the `always` of its kind when there is no once option, but the locked row says an `always` is sent only when the person chose it.
The locked row was followed: with no once option of the answer's kind the server is answered `cancelled`.
This also drops the old fallback of a refusal to `reject_always` when a server offered no `reject_once`.
Confirm, or say which one should win.
- An option whose kind does not match `approved` (an approval naming a deny option) is ignored and the once option of the answer's kind is sent; the plan does not say.
- The schema check covers the frames this task adds, not every frame: the ACP backend already sends defects the checker reports, which this task did not touch: `chat/turnStarted` and the active turn's `message` without `origin`, a `session/customizationsChanged` entry whose `type` is not in the union, and snapshot response parts with an undeclared `id` key.

Gates: `pnpm typecheck` clean; `pnpm boundary` clean; `pnpm test` 107 files, 1537 tests, 1536 passed; the one failure was `advertises exactly the ports it was given, and nothing more` in `agent-acp-ports.test.ts`, the known flake, and that file alone passed 8 of 8.
