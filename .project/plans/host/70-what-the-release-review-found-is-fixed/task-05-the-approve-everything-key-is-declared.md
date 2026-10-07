---
title: The approve-everything key is declared
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/root.ts#L210-L228](../../../../packages/sdk/src/host/root.ts#L210-L228) - `ROOT_CONFIG_SCHEMA`, where the key is declared"
  - "[code://packages/sdk/src/host/trust.ts#L163](../../../../packages/sdk/src/host/trust.ts#L163) - `autoApproved`"
---

## Objective

`globalAutoApproveEnabled` is in the root config schema, so a client can see it and turn it off.

## Files

- `UPDATE: packages/sdk/src/host/root.ts:210-228` - declare the key.
- `UPDATE: packages/sdk/test/root-config.test.ts` - the case below, and the key lists it moves.

## Steps

1. Declare `globalAutoApproveEnabled` as a boolean with default `false`.
2. Give it the title "Approve Everything" and a one-sentence description for a person.

## Validation

- `it('lists globalAutoApproveEnabled in the root config schema with default false')`
- Run the full gates from the plan. All pass.

## Resume

- **Implemented** 2026-10-07 on `build/agents-4f2c8f8e`.
- `root.ts`: the key is the last of the host's own in `ROOT_CONFIG_SCHEMA`, after `deferredTitleGeneration`. It is a boolean with `default: false`, titled "Approve Everything", and described as running every tool call without asking for every session on the host. The comment says what reads it and why a host that approves everything is one a person could not see or change before this.
- `root-config.test.ts`: the named case, which reads the whole shape off an admin's root state, and the three key lists it sits in. The case also asserts no value is held until somebody pushes one, because the default is the client's own to draw.
- `wire.jsonl`: the recorded capture moved with the schema, which is what it is for. Two root states in it carry the new property.
