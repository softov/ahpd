---
title: A refusal is said as denied
status: done
depends: []
layer: agent-cofold
refs:
  - "[code://packages/agent-cofold/src/pauses.ts#L225-L232](../../../../packages/agent-cofold/src/pauses.ts#L225-L232) - the refusal cofold says back"
---

## Objective

cofold says a refusal with the reason `denied`, and gives the model its own sentence.

## Files

- `UPDATE: packages/agent-cofold/src/pauses.ts:225-232` - the refusal's reason.
- `UPDATE: packages/agent-cofold/test/agent-cofold-approval.test.ts` - a refusal sent with no reason.

## Steps

1. Say `denied` for a refusal, and keep the sentence for the model.
2. Add a case that sends a refusal with no reason and reads it back.

## Validation

- `packages/agent-cofold/test/agent-cofold-approval.test.ts`: the new case fails on `89ebe4d5` and passes after.
- The agent-cofold test files pass.
- `pnpm run typecheck` is clean.

## Resume

Built 2026-11-02.

- A client's own reason already wins in the answer, so only a refusal sent with no reason met the sentence.
- On `89ebe4d5`'s sources the new case fails: the reason read "The person declined this action".
