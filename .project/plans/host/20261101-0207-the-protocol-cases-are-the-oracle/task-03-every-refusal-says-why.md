---
title: Every refusal says why
status: todo
depends: [02]
layer: "sdk tests"
refs:
  - "[code://packages/sdk/test/ahp-test-cases.test.ts#L241-L552](../../../../packages/sdk/test/ahp-test-cases.test.ts#L241-L552) - `NOT_REPLAYED` and `HOST_REFUSED`, refusals named without their reasons asserted"
  - "https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/types/common/reducer-helpers.ts#L41-L46 - an action a client may not originate is rejected"
  - "https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/specification/chat-channel.md#L345-L360 - the chat channel's validation rows"
---

## Objective

Every refusal a case meets is asserted with the host's reason and the source that allows it.
An action a client may not originate is refused by the protocol's own rule.
Any other refusal names its row of the specification or the host policy it applies.
A refusal the specification does not allow is a divergence entry.

## Files

- `UPDATE: packages/sdk/test/ahp-test-cases.test.ts:241-552` - `NOT_REPLAYED` and `HOST_REFUSED` give way to `REFUSALS`: each case's reason and its source.

## Steps

1. Refuse every action outside `IS_CLIENT_DISPATCHABLE` with the host's sentence for it, read from the protocol's map.
2. Hold every other refusal to its entry in `REFUSALS` or in `DIVERGES`.
3. Write each `REFUSALS` entry's source as a specification row or a named host policy.

## Validation

- `pnpm exec vitest run packages/sdk/test/ahp-test-cases.test.ts` passes, and a changed reason fails its case.

## Resume
