---
title: A Claude session's model and a skill's argument hint are sent as ahpd keys
status: todo
depends: []
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/session.ts#L3125-L3127](../../../../packages/agent-claude/src/session.ts#L3125-L3127) - `_meta: { model }` on the session state"
  - "[code://packages/agent-claude/src/session.ts#L326](../../../../packages/agent-claude/src/session.ts#L326) - `_meta: { argumentHint }` on a skill customization"
  - "[code://packages/sdk/src/host.ts#L8103](../../../../packages/sdk/src/host.ts#L8103) - `argumentHint` on a completion item, the reference client's, which stays"
  - "[code://docs/AHP.md#L556-L569](../../../../docs/AHP.md#L556-L569) - why the completion item's key is the reference's"
  - "file:///github/ahpc/src/ahp/live.ts - line 3166, the reader of `_meta.model`"
---

## Objective

A Claude session state carries `_meta['ahpd.model']` and a skill customization `_meta['ahpd.argumentHint']`; a completion item keeps the reference's `argumentHint`.

## Files

- `UPDATE: packages/agent-claude/src/session.ts:3126` - `ahpd.model`.
- `UPDATE: packages/agent-claude/src/session.ts:326` - `ahpd.argumentHint`; check where the host reads a skill's hint to build a completion item (`rg -n "argumentHint" packages/sdk/src/host.ts`, :8007) and read the new key there.
- `UPDATE: packages/agent-claude/test/*.test.ts` - assertions on either key.
- `UPDATE: packages/sdk/test/wire.test.ts` - `model` and the skill's `argumentHint` leave `PENDING`; its skill has a hint.

## Steps

1. Confirm ahpc's release reads `_meta['ahpd.model']` beside `_meta.model`; do not merge before.
2. Rename both producers and the host's reader of the skill hint, if it reads the customization.

## Validation

- `packages/sdk/test/wire.test.ts` passes with `model` and the skill's `argumentHint` gone from `PENDING`, and the completion item's `argumentHint` still allowed by `REFERENCE`.
- A completions test: the `/` menu still shows the skill's hint as ghost text.
- `pnpm test` passes.

## Resume
